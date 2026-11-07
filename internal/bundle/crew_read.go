package bundle

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/pocketcontext-labs/pocketcontext-crew/internal/crewread/searchread"
)

// registerCrewReads adds the authenticated Go read routes. Ranked search reads
// through the application's own database connection pool; nothing here writes.
func registerCrewReads(app core.App) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		pool, ok := app.ConcurrentDB().(*dbx.DB)
		if !ok {
			return errors.New("crew search requires the application database pool")
		}
		search := searchread.New(pool.DB(), searchread.Config{})
		app.OnTerminate().BindFunc(func(te *core.TerminateEvent) error {
			defer search.Close()
			return te.Next()
		})
		e.Router.POST("/api/crew/search", func(re *core.RequestEvent) error {
			return crewSearch(re, search)
		}).Bind(apis.RequireAuth("users"))
		return e.Next()
	})
}

// decodeCrewBody accepts exactly one bounded JSON object without unknown fields.
func decodeCrewBody(re *core.RequestEvent, limit int64, target any) error {
	re.Request.Body = http.MaxBytesReader(re.Response, re.Request.Body, limit)
	decoder := json.NewDecoder(re.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("expected one JSON object")
	}
	return nil
}

func crewSearch(re *core.RequestEvent, search *searchread.Engine) error {
	re.Response.Header().Set("Cache-Control", "no-store")
	var body struct {
		Query       string   `json:"query"`
		Collections []string `json:"collections"`
		Limit       int      `json:"limit"`
		Offset      int      `json:"offset"`
		Archived    bool     `json:"archived"`
		Generation  string   `json:"generation"`
	}
	if err := decodeCrewBody(re, 65536, &body); err != nil {
		return re.BadRequestError("Expected JSON with query and optional collections, limit, offset, archived and generation", nil)
	}
	result, err := search.Search(re.Request.Context(), searchread.Request{Query: body.Query, Collections: body.Collections, Limit: body.Limit, Offset: body.Offset, Archived: body.Archived, Generation: body.Generation})
	switch {
	case err == nil:
		return re.JSON(http.StatusOK, result)
	case errors.Is(err, searchread.ErrInvalidQuery):
		return re.BadRequestError(err.Error(), nil)
	case errors.Is(err, searchread.ErrGenerationChanged):
		return re.JSON(http.StatusConflict, map[string]any{"status": 409, "message": err.Error(), "data": map[string]any{"generation": result.Generation}})
	case errors.Is(err, searchread.ErrIndexLimit):
		return re.JSON(http.StatusRequestEntityTooLarge, map[string]any{"status": 413, "message": "Search index exceeds its size limit; use crew_read filters", "data": map[string]any{}})
	case errors.Is(err, context.DeadlineExceeded):
		return re.JSON(http.StatusRequestTimeout, map[string]any{"status": 408, "message": "Search deadline exceeded", "data": map[string]any{}})
	default:
		re.App.Logger().Warn("crew search failed", "error", err.Error())
		return re.InternalServerError("Search failed", nil)
	}
}
