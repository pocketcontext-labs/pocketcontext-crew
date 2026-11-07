package sqlread

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	sqlite3 "github.com/mattn/go-sqlite3"
)

var fixtureViews = []View{
	{Name: "people", Table: "crew_people", Columns: []string{"id", "name"}},
	{Name: "deals", Table: "crew_deals", Columns: []string{"id", "person", "value", "tags"}},
}

func fixture(t *testing.T, cfg Config) (*Engine, *sql.DB) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "data.db")
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	_, err = db.Exec(`PRAGMA journal_mode=WAL; CREATE TABLE crew_people(id TEXT PRIMARY KEY,name TEXT,secret TEXT);CREATE TABLE crew_deals(id TEXT,person TEXT,value INTEGER,tags JSON);CREATE TABLE private(token TEXT);INSERT INTO crew_people VALUES('p1','Ada','secret');INSERT INTO crew_deals VALUES('d1','p1',42,'["a","b"]'),('d2','p1',58,'[]');INSERT INTO private VALUES('secret');CREATE VIEW leak AS SELECT * FROM private;`)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Views == nil {
		cfg.Views = fixtureViews
	}
	e, err := New(path, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { e.Close() })
	return e, db
}

func TestReads(t *testing.T) {
	e, db := fixture(t, Config{})
	ctx := context.Background()
	for _, query := range []string{
		`SELECT p.name,sum(d.value) FROM people p JOIN deals d ON p.id=d.person GROUP BY p.id`,
		`SELECT * FROM people`,
		`WITH c AS (SELECT value FROM deals) SELECT sum(value) FROM c`,
		`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<10) SELECT sum(n) FROM seq`,
		`SELECT count(*) FROM people`,
		`SELECT ';', 'it''s;fine', 1 AS "semi;colon"; -- comment`,
		`SELECT value, row_number() OVER (ORDER BY value) FROM deals`,
		`SELECT sqrt(4), ceil(1.5), pow(2,3), mod(5,2)`,
		`SELECT '{"a":1}' ->> '$.a'`,
		`SELECT d.id, j.value FROM deals d, json_each(d.tags) j`,
		`SELECT median(value), percentile(value, 90) FROM deals`,
		`EXPLAIN QUERY PLAN SELECT name FROM people`,
	} {
		t.Run(query, func(t *testing.T) {
			r, err := e.Query(ctx, query)
			if err != nil {
				t.Fatal(err)
			}
			if len(r.Rows) == 0 {
				t.Fatal("no rows")
			}
		})
	}
	r, err := e.Query(ctx, `SELECT * FROM people`)
	if err != nil || fmt.Sprint(r.Columns) != "[id name]" {
		t.Fatalf("view exposes %v: %v", r.Columns, err)
	}
	if _, err := db.Exec(`INSERT INTO crew_people VALUES('p2','Grace','hidden')`); err != nil {
		t.Fatal(err)
	}
	r, err = e.Query(ctx, `SELECT name FROM people ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Rows) != 2 || r.Rows[1][0] != "Grace" {
		t.Fatalf("new commit invisible: %#v", r)
	}
	schema, err := e.Schema(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(schema) != 2 || schema[0].Name != "deals" || schema[1].Name != "people" || len(schema[1].Columns) != 2 {
		t.Fatalf("wrong schema %#v", schema)
	}
}

func TestDeniedQueries(t *testing.T) {
	e, _ := fixture(t, Config{})
	for _, query := range []string{
		`SELECT * FROM private`, `SELECT count(*) FROM private`, `SELECT secret FROM crew_people`, `SELECT * FROM crew_people`, `SELECT * FROM main.crew_people`,
		`SELECT secret FROM people`, `SELECT token FROM private UNION SELECT name FROM people`, `WITH x AS (SELECT token FROM private) SELECT * FROM x`,
		`SELECT (SELECT token FROM private) FROM people`, `SELECT name FROM people WHERE EXISTS(SELECT 1 FROM private)`,
		`SELECT name FROM people WHERE EXISTS(SELECT secret FROM crew_people)`,
		`SELECT * FROM sqlite_schema`, `SELECT * FROM sqlite_temp_schema`, `SELECT * FROM temp.sqlite_master`, `SELECT * FROM leak`,
		`SELECT * FROM pragma_table_info('private')`, `PRAGMA table_info(people)`, `PRAGMA query_only=OFF`, `PRAGMA writable_schema=ON`,
		`INSERT INTO crew_people VALUES('p2','bad','bad') RETURNING name`, `UPDATE crew_people SET name='bad' RETURNING name`, `DELETE FROM crew_deals RETURNING id`,
		`INSERT INTO people VALUES('p3','bad')`, `DROP VIEW people`, `CREATE TEMP VIEW x AS SELECT secret FROM crew_people`,
		`CREATE TABLE bad(x)`, `DROP TABLE crew_deals`, `ATTACH ':memory:' AS other`, `DETACH main`, `BEGIN`, `COMMIT`, `VACUUM`, `ANALYZE`, `REINDEX`,
		`SELECT load_extension('foo')`, `SELECT randomblob(1000000000)`, `SELECT readfile('/etc/passwd')`, `SELECT writefile('/tmp/x','y')`,
		`SELECT sqlite_version()`, `SELECT changes()`, `SELECT last_insert_rowid()`,
		`SELECT 1; SELECT 2`, `SELECT 1; /*x*/ DELETE FROM crew_deals`, `SELECT 1;;`, `SELECT 1; ATTACH ':memory:' AS x`,
		"SELECT 1\x00; DELETE FROM crew_deals", `-- empty`, `SELECT 'unterminated`, `SELECT 1 /*unterminated`,
	} {
		t.Run(query, func(t *testing.T) {
			if _, err := e.Query(context.Background(), query); err == nil {
				t.Fatal("query unexpectedly permitted")
			}
		})
	}
}

// VACUUM passes the authorizer, so only the read-only check stops it.
func TestNonReadOnlyStatementsRejected(t *testing.T) {
	e, _ := fixture(t, Config{})
	ctx := context.Background()
	out := filepath.Join(t.TempDir(), "copy.db")
	for i := 0; i < 8; i++ {
		for _, query := range []string{`VACUUM INTO '` + out + `'`, `EXPLAIN VACUUM INTO '` + out + `'`, `VACUUM`, `VACUUM; -- comment`} {
			if _, err := e.Query(ctx, query); !errors.Is(err, ErrNotReadOnly) {
				t.Fatalf("%q: expected ErrNotReadOnly, got %v", query, err)
			}
		}
	}
	if _, err := os.Stat(out); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("VACUUM INTO wrote %s: %v", out, err)
	}
	if _, err := e.db.BeginTx(ctx, nil); err == nil {
		t.Fatal("transaction opened on reader")
	}
	if _, err := e.db.ExecContext(ctx, `VACUUM`); !errors.Is(err, ErrNotReadOnly) {
		t.Fatalf("direct exec bypassed the read-only check: %v", err)
	}
	if _, err := e.Query(ctx, `SELECT 1`); err != nil {
		t.Fatalf("engine unusable after rejections: %v", err)
	}
}

func TestLimitsAndCancellation(t *testing.T) {
	e, _ := fixture(t, Config{MaxRows: 3, MaxBytes: 512, Timeout: 20 * time.Millisecond})
	r, err := e.Query(context.Background(), `WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<100) SELECT n FROM x`)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Truncated || len(r.Rows) != 3 {
		t.Fatalf("row cap failed: %#v", r)
	}
	if _, err = e.Query(context.Background(), `WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT sum(n) FROM x`); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unbounded recursion did not return deadline: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = e.Query(ctx, `SELECT 1`); err == nil {
		t.Fatal("cancel ignored")
	}
	if _, err = e.Query(context.Background(), `SELECT printf('%1000000000s','x')`); err == nil {
		t.Fatal("huge scalar allowed")
	}
	if _, err = e.Query(context.Background(), `SELECT 1`); err != nil {
		t.Fatalf("connection unusable after interrupt: %v", err)
	}
	e2, _ := fixture(t, Config{MaxBytes: 128})
	r, err = e2.Query(context.Background(), `WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<100) SELECT n,'abcdefghij' FROM x`)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(r)
	if !r.Truncated || len(data) > 128 {
		t.Fatalf("byte cap failed: %s", data)
	}
}

func TestSchemaConfiguration(t *testing.T) {
	_, db := fixture(t, Config{})
	var path string
	var seq int
	var name string
	if err := db.QueryRow(`PRAGMA database_list`).Scan(&seq, &name, &path); err != nil {
		t.Fatal(err)
	}
	for _, views := range [][]View{
		nil,
		{{Name: "people", Table: "crew_people"}},
		{{Name: "people", Table: "crew_people", Columns: []string{"missing"}}},
		{{Name: "people", Table: "crew_people", Columns: []string{"id", "id"}}},
		{{Name: "schema", Table: "sqlite_schema", Columns: []string{"sql"}}},
		{{Name: "leak", Table: "leak", Columns: []string{"token"}}},
		{{Name: "x", Table: "missing", Columns: []string{"id"}}},
		{{Name: "json_each", Table: "crew_people", Columns: []string{"id"}}},
		{{Name: "Bad Name", Table: "crew_people", Columns: []string{"id"}}},
		{{Name: "a", Table: "crew_people", Columns: []string{"id"}}, {Name: "a", Table: "crew_deals", Columns: []string{"id"}}},
		{{Name: "a", Table: "crew_people", Columns: []string{"id"}}, {Name: "b", Table: "crew_people", Columns: []string{"name"}}},
	} {
		if engine, err := New(path, Config{Views: views}); err == nil {
			engine.Close()
			t.Fatalf("accepted bad config %v", views)
		}
	}
}

func TestClassifyBusy(t *testing.T) {
	for _, code := range []sqlite3.ErrNo{sqlite3.ErrBusy, sqlite3.ErrLocked} {
		if err := classify(fmt.Errorf("prepare: %w", sqlite3.Error{Code: code})); !errors.Is(err, ErrBusy) {
			t.Fatalf("code %d not classified as busy: %v", code, err)
		}
	}
}
