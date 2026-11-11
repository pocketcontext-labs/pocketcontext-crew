// Package searchread ranks Crew notes and tasks with an in-memory SQLite FTS5
// index. Adapted from PocketContext's built search indexes (searchread
// memindex): there are no spaces, publications or sources here.
//
// Freshness: every request reads small change metadata (collection, id,
// revision, updated and effective archive state) for all notes and tasks inside
// one read transaction of the application's own database connection. Every
// Crew content or archive change increments revision and updates the autodate,
// so the fingerprint of these rows changes whenever indexed content or archive
// visibility changes, including bucket archival (which changes the effective
// state of its notes). Attachment names are indexed with their task or note;
// attachment writes leave the parent's revision alone, so the attachment rows
// (id, parent, revision, updated, archived) enter the fingerprint too. The
// fingerprint is the exposed generation and the cache
// key; on a mismatch the index is rebuilt from the same transaction. Hit
// metadata (status, assignment, bucket) is taken from that fresh read.
package searchread

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	sqlite3 "github.com/mattn/go-sqlite3"
)

const (
	DefaultMaxIndexBytes = 64 << 20
	DefaultTimeout       = 5 * time.Second
	MaxQueryBytes        = 1024
	MaxTerms             = 32
	MaxLimit             = 50
	DefaultLimit         = 10
	MaxOffset            = 10000
	excerptRunes         = 240
	// Bump when tokenization, ranking or fingerprint semantics change.
	contractVersion = "crew-search-v2"
)

var (
	ErrInvalidQuery      = errors.New("invalid search request")
	ErrGenerationChanged = errors.New("search generation changed; restart from offset 0 without generation")
	ErrIndexLimit        = errors.New("search index size limit exceeded")
	ErrIndexInvalid      = errors.New("search index invalid")
)

// Collections are the searchable collections, in default order.
var Collections = []string{"notes", "tasks"}

type Config struct {
	MaxIndexBytes int
	Timeout       time.Duration
}

type Request struct {
	Query       string
	Collections []string
	Limit       int
	Offset      int
	Archived    bool
	Generation  string
}

type Hit struct {
	Collection        string  `json:"collection"`
	ID                string  `json:"id"`
	Title             string  `json:"title"`
	Path              string  `json:"path"`
	URL               string  `json:"url,omitempty"`
	Excerpt           string  `json:"excerpt"`
	Revision          int64   `json:"revision"`
	Updated           string  `json:"updated"`
	Score             float64 `json:"score"`
	Bucket            *string `json:"bucket,omitempty"`
	BucketName        *string `json:"bucket_name,omitempty"`
	Status            *string `json:"status,omitempty"`
	Readiness         *string `json:"readiness,omitempty"`
	AssignedAgent     *string `json:"assigned_agent,omitempty"`
	AssignedAgentName *string `json:"assigned_agent_name,omitempty"`
}

type Result struct {
	Items      []Hit  `json:"items"`
	HasMore    bool   `json:"has_more"`
	NextOffset *int   `json:"next_offset"`
	Generation string `json:"generation"`
}

type meta struct {
	collection, id, updated             string
	revision                            int64
	archived                            bool
	bucket, bucketName                  string
	status, readiness, agent, agentName string
}

type row struct {
	key, collection    string
	archived           bool
	title, body, draft string
	files              string // names of the item's active attachments
}

type index struct {
	key  string
	conn *sqlite3.SQLiteConn
	mu   sync.Mutex // one statement at a time on the connection
	refs int
	gone bool
}

// Engine searches through db, the application's own database connection pool.
// It never opens the database file itself.
type Engine struct {
	db    *sql.DB
	cfg   Config
	build sync.Mutex
	mu    sync.Mutex
	cur   *index
}

func New(db *sql.DB, cfg Config) *Engine {
	if cfg.MaxIndexBytes <= 0 {
		cfg.MaxIndexBytes = DefaultMaxIndexBytes
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = DefaultTimeout
	}
	return &Engine{db: db, cfg: cfg}
}

func (e *Engine) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur != nil {
		e.retireLocked(e.cur)
		e.cur = nil
	}
	return nil
}

// Normalize validates a request and applies defaults.
func Normalize(req *Request) error {
	if len(req.Query) > MaxQueryBytes || !utf8.ValidString(req.Query) || strings.IndexByte(req.Query, 0) >= 0 {
		return fmt.Errorf("%w: query must be valid text of at most %d bytes", ErrInvalidQuery, MaxQueryBytes)
	}
	if req.Limit == 0 {
		req.Limit = DefaultLimit
	}
	if req.Limit < 1 || req.Limit > MaxLimit {
		return fmt.Errorf("%w: limit must be 1-%d", ErrInvalidQuery, MaxLimit)
	}
	if req.Offset < 0 || req.Offset > MaxOffset {
		return fmt.Errorf("%w: offset must be 0-%d", ErrInvalidQuery, MaxOffset)
	}
	if len(req.Collections) == 0 {
		req.Collections = append([]string(nil), Collections...)
	}
	seen := map[string]bool{}
	for _, c := range req.Collections {
		if c != "notes" && c != "tasks" {
			return fmt.Errorf("%w: collections may contain notes and tasks", ErrInvalidQuery)
		}
		if seen[c] {
			return fmt.Errorf("%w: duplicate collection %s", ErrInvalidQuery, c)
		}
		seen[c] = true
	}
	if len(req.Generation) > 64 {
		return fmt.Errorf("%w: invalid generation", ErrInvalidQuery)
	}
	_, err := matchExpression(req.Query)
	return err
}

// matchExpression treats every whitespace-separated term as a literal FTS5
// string; all terms must match. A trailing * requests a prefix match.
func matchExpression(query string) (string, error) {
	terms := strings.Fields(query)
	if len(terms) == 0 || len(terms) > MaxTerms {
		return "", fmt.Errorf("%w: query needs 1-%d terms", ErrInvalidQuery, MaxTerms)
	}
	for i, term := range terms {
		prefix := ""
		if len(term) > 1 && strings.HasSuffix(term, "*") {
			term, prefix = strings.TrimRight(term, "*"), "*"
		}
		if term == "" {
			return "", fmt.Errorf("%w: empty term", ErrInvalidQuery)
		}
		terms[i] = `"` + strings.ReplaceAll(term, `"`, `""`) + `"` + prefix
	}
	return strings.Join(terms, " AND "), nil
}

func (e *Engine) Search(ctx context.Context, req Request) (Result, error) {
	result := Result{Items: []Hit{}}
	if err := Normalize(&req); err != nil {
		return result, err
	}
	match, _ := matchExpression(req.Query)
	ctx, cancel := context.WithTimeout(ctx, e.cfg.Timeout)
	defer cancel()
	tx, err := e.db.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	metas, generation, err := readMeta(ctx, tx)
	if err != nil {
		return result, err
	}
	result.Generation = generation
	if req.Generation != "" && req.Generation != generation {
		return result, ErrGenerationChanged
	}
	idx := e.acquire(generation)
	if idx == nil {
		e.build.Lock()
		idx = e.acquire(generation)
		if idx == nil {
			var rows []row
			rows, err = e.readRows(ctx, tx, metas)
			if err == nil {
				idx, err = e.buildIndex(ctx, generation, rows)
			}
			if err == nil {
				e.install(idx)
			}
		}
		e.build.Unlock()
		if err != nil {
			return result, err
		}
	}
	defer e.release(idx)
	_ = tx.Rollback() // all database reads are complete
	hits, more, err := queryIndex(ctx, idx, match, req)
	if err != nil {
		return result, err
	}
	for _, h := range hits {
		m, ok := metas[h.Collection+":"+h.ID]
		if !ok {
			return result, ErrIndexInvalid
		}
		h.Revision, h.Updated = m.revision, m.updated
		if m.collection == "notes" {
			h.Bucket, h.BucketName = ptr(m.bucket), ptr(m.bucketName)
		} else {
			h.Status, h.Readiness, h.AssignedAgent, h.AssignedAgentName = ptr(m.status), ptr(m.readiness), ptr(m.agent), ptr(m.agentName)
		}
		result.Items = append(result.Items, h)
	}
	if more {
		result.HasMore = true
		next := req.Offset + req.Limit
		result.NextOffset = &next
	}
	return result, nil
}

func ptr(s string) *string { return &s }

func readMeta(ctx context.Context, tx *sql.Tx) (map[string]meta, string, error) {
	out := map[string]meta{}
	list := []meta{}
	rows, err := tx.QueryContext(ctx, `SELECT n.id, CAST(n.revision AS INTEGER), n.updated,
  (COALESCE(n.archived,0)!=0 OR COALESCE(b.archived,0)!=0), n.bucket, COALESCE(b.name,'')
FROM crew_notes n LEFT JOIN crew_buckets b ON b.id=n.bucket ORDER BY n.id`)
	if err != nil {
		return nil, "", err
	}
	for rows.Next() {
		m := meta{collection: "notes"}
		if err := rows.Scan(&m.id, &m.revision, &m.updated, &m.archived, &m.bucket, &m.bucketName); err != nil {
			rows.Close()
			return nil, "", err
		}
		list = append(list, m)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, "", err
	}
	rows, err = tx.QueryContext(ctx, `SELECT t.id, CAST(t.revision AS INTEGER), t.updated, COALESCE(t.archived,0)!=0,
  COALESCE(t.status,''), COALESCE(t.readiness,''), COALESCE(t.assigned_agent,''), COALESCE(a.name,'')
FROM crew_tasks t LEFT JOIN crew_agents a ON a.id=t.assigned_agent ORDER BY t.id`)
	if err != nil {
		return nil, "", err
	}
	for rows.Next() {
		m := meta{collection: "tasks"}
		if err := rows.Scan(&m.id, &m.revision, &m.updated, &m.archived, &m.status, &m.readiness, &m.agent, &m.agentName); err != nil {
			rows.Close()
			return nil, "", err
		}
		list = append(list, m)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, "", err
	}
	// Attachment adds, archives and restores change their own rows, not the
	// parent's revision, so they enter the fingerprint separately.
	attachments := [][]any{}
	rows, err = tx.QueryContext(ctx, `SELECT id, parent, CAST(revision AS INTEGER), updated, COALESCE(archived,0)!=0 FROM crew_attachments ORDER BY id`)
	if err != nil {
		return nil, "", err
	}
	for rows.Next() {
		var id, parent, updated string
		var revision int64
		var archived bool
		if err := rows.Scan(&id, &parent, &revision, &updated, &archived); err != nil {
			rows.Close()
			return nil, "", err
		}
		attachments = append(attachments, []any{"attachments", id, parent, revision, updated, archived})
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, "", err
	}
	version, number, source := sqlite3.Version()
	h := sha256.New()
	header, _ := json.Marshal([]any{contractVersion, version, number, source, len(list), len(attachments)})
	h.Write(header)
	for _, m := range list {
		line, _ := json.Marshal([]any{m.collection, m.id, m.revision, m.updated, m.archived})
		h.Write(line)
		out[m.collection+":"+m.id] = m
	}
	for _, a := range attachments {
		line, _ := json.Marshal(a)
		h.Write(line)
	}
	return out, fmt.Sprintf("%x", h.Sum(nil))[:32], nil
}

func (e *Engine) readRows(ctx context.Context, tx *sql.Tx, metas map[string]meta) ([]row, error) {
	out := []row{}
	size := 0
	files := map[string]string{}
	names, err := tx.QueryContext(ctx, `SELECT parent, name FROM crew_attachments WHERE COALESCE(archived,0)=0 ORDER BY parent, position`)
	if err != nil {
		return nil, err
	}
	for names.Next() {
		var parent, name string
		if err := names.Scan(&parent, &name); err != nil {
			names.Close()
			return nil, err
		}
		if files[parent] != "" {
			files[parent] += "\n"
		}
		files[parent] += name
	}
	if err := errors.Join(names.Err(), names.Close()); err != nil {
		return nil, err
	}
	add := func(r row) error {
		size += len(r.key) + len(r.title) + len(r.body) + len(r.draft) + len(r.files)
		if size > e.cfg.MaxIndexBytes {
			return ErrIndexLimit
		}
		out = append(out, r)
		return nil
	}
	for _, q := range []struct{ collection, sql string }{
		{"notes", `SELECT id, COALESCE(title,''), COALESCE(body,''), '' FROM crew_notes ORDER BY id`},
		{"tasks", `SELECT id, COALESCE(title,''), COALESCE(description,''), COALESCE(draft,'') FROM crew_tasks ORDER BY id`},
	} {
		rows, err := tx.QueryContext(ctx, q.sql)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			r := row{collection: q.collection}
			var id string
			if err := rows.Scan(&id, &r.title, &r.body, &r.draft); err != nil {
				rows.Close()
				return nil, err
			}
			m, ok := metas[q.collection+":"+id]
			if !ok {
				rows.Close()
				return nil, ErrIndexInvalid
			}
			r.key, r.archived, r.files = id, m.archived, files[id]
			if err := add(r); err != nil {
				rows.Close()
				return nil, err
			}
		}
		if err := errors.Join(rows.Err(), rows.Close()); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (e *Engine) buildIndex(ctx context.Context, key string, rows []row) (*index, error) {
	raw, err := (&sqlite3.SQLiteDriver{}).Open(":memory:")
	if err != nil {
		return nil, err
	}
	conn := raw.(*sqlite3.SQLiteConn)
	ok := false
	defer func() {
		if !ok {
			conn.Close()
		}
	}()
	conn.SetLimit(sqlite3.SQLITE_LIMIT_LENGTH, e.cfg.MaxIndexBytes+65536)
	conn.SetLimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 65536)
	conn.SetLimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
	fail := func(err error) (*index, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		var se sqlite3.Error
		if errors.As(err, &se) && (se.Code == sqlite3.ErrFull || se.Code == sqlite3.ErrTooBig) {
			return nil, ErrIndexLimit
		}
		return nil, err
	}
	// Content and index together stay well below four times the indexed text.
	pages := e.cfg.MaxIndexBytes*4/4096 + 256
	if _, err = conn.ExecContext(ctx, fmt.Sprintf("PRAGMA page_size=4096; PRAGMA max_page_count=%d; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY", pages), nil); err != nil {
		return fail(err)
	}
	if _, err = conn.ExecContext(ctx, `CREATE VIRTUAL TABLE search USING fts5(key UNINDEXED, collection UNINDEXED, archived UNINDEXED, title, body, draft, files, tokenize='unicode61 remove_diacritics 2')`, nil); err != nil {
		return fail(err)
	}
	if _, err = conn.ExecContext(ctx, "BEGIN", nil); err != nil {
		return fail(err)
	}
	stmt, err := conn.Prepare("INSERT INTO search(key, collection, archived, title, body, draft, files) VALUES (?, ?, ?, ?, ?, ?, ?)")
	if err != nil {
		return fail(err)
	}
	insert := stmt.(driver.StmtExecContext)
	for _, r := range rows {
		archived := int64(0)
		if r.archived {
			archived = 1
		}
		if _, err = insert.ExecContext(ctx, []driver.NamedValue{{Ordinal: 1, Value: r.key}, {Ordinal: 2, Value: r.collection}, {Ordinal: 3, Value: archived}, {Ordinal: 4, Value: r.title}, {Ordinal: 5, Value: r.body}, {Ordinal: 6, Value: r.draft}, {Ordinal: 7, Value: r.files}}); err != nil {
			stmt.Close()
			return fail(err)
		}
	}
	stmt.Close()
	if _, err = conn.ExecContext(ctx, "COMMIT", nil); err != nil {
		return fail(err)
	}
	if _, err = conn.ExecContext(ctx, "PRAGMA query_only=1", nil); err != nil {
		return fail(err)
	}
	conn.RegisterAuthorizer(func(op int, a, b, db string) int {
		switch op {
		case sqlite3.SQLITE_SELECT:
			return sqlite3.SQLITE_OK
		case sqlite3.SQLITE_READ:
			if db == "main" || db == "" {
				return sqlite3.SQLITE_OK
			}
		case sqlite3.SQLITE_FUNCTION:
			switch strings.ToLower(b) {
			case "match", "bm25", "snippet":
				return sqlite3.SQLITE_OK
			}
		case sqlite3.SQLITE_PRAGMA:
			// FTS5 checks for concurrent changes with data_version.
			if strings.EqualFold(a, "data_version") && b == "" && db == "main" {
				return sqlite3.SQLITE_OK
			}
		}
		return sqlite3.SQLITE_DENY
	})
	ok = true
	return &index{key: key, conn: conn}, nil
}

func queryIndex(ctx context.Context, idx *index, match string, req Request) ([]Hit, bool, error) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.conn == nil {
		return nil, false, ErrIndexInvalid
	}
	cols := append([]string(nil), req.Collections...)
	sort.Strings(cols)
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(cols)), ",")
	archived := int64(0)
	if req.Archived {
		archived = 1
	}
	args := []driver.NamedValue{{Ordinal: 1, Value: match}, {Ordinal: 2, Value: archived}}
	for _, c := range cols {
		args = append(args, driver.NamedValue{Ordinal: len(args) + 1, Value: c})
	}
	args = append(args, driver.NamedValue{Ordinal: len(args) + 1, Value: int64(req.Limit + 1)}, driver.NamedValue{Ordinal: len(args) + 2, Value: int64(req.Offset)})
	// Title matches weigh most; drafts least; attachment names like the body.
	// Ties order by ID for stable pages.
	query := `SELECT key, collection, bm25(search, 0, 0, 0, 5.0, 1.0, 0.5, 1.0) AS rank, title, snippet(search, -1, '«', '»', '…', 12)
FROM search WHERE search MATCH ? AND archived = ? AND collection IN (` + placeholders + `)
ORDER BY rank, collection, key LIMIT ? OFFSET ?`
	rows, err := idx.conn.QueryContext(ctx, query, args)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	hits := []Hit{}
	dest := make([]driver.Value, 5)
	for {
		err := rows.Next(dest)
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, false, err
		}
		if len(hits) == req.Limit {
			return hits, true, nil
		}
		key, ok1 := dest[0].(string)
		collection, ok2 := dest[1].(string)
		rank, ok3 := dest[2].(float64)
		title, _ := dest[3].(string)
		excerpt, _ := dest[4].(string)
		if !ok1 || !ok2 || !ok3 || math.IsNaN(rank) || math.IsInf(rank, 0) {
			return nil, false, ErrIndexInvalid
		}
		if r := []rune(excerpt); len(r) > excerptRunes {
			excerpt = string(r[:excerptRunes]) + "…"
		}
		hits = append(hits, Hit{Collection: collection, ID: key, Title: title, Excerpt: excerpt, Score: -rank})
	}
	return hits, false, ctx.Err()
}

func (e *Engine) acquire(key string) *index {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil || e.cur.key != key {
		return nil
	}
	e.cur.refs++
	return e.cur
}

// install replaces the cached index with a newly built one held by the caller.
// Only one index is retained; a replaced index closes after its last query.
func (e *Engine) install(idx *index) {
	e.mu.Lock()
	defer e.mu.Unlock()
	idx.refs = 1
	if e.cur != nil {
		e.retireLocked(e.cur)
	}
	e.cur = idx
}

func (e *Engine) release(idx *index) {
	e.mu.Lock()
	defer e.mu.Unlock()
	idx.refs--
	if idx.gone && idx.refs == 0 {
		closeIndex(idx)
	}
}

func (e *Engine) retireLocked(idx *index) {
	idx.gone = true
	if idx.refs == 0 {
		closeIndex(idx)
	}
}

func closeIndex(idx *index) {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.conn != nil {
		idx.conn.Close()
		idx.conn = nil
	}
}
