package client

// The CLI work commands call the same Crew routes as the MCP tools, with the
// same input shapes and request builders. Writes use only the work-client
// route, so CLI agents get exactly the MCP operations: every reader operation
// except webhook credential entry, silent comments and counted handoffs.
import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"reflect"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
)

// crewCommandInputLimit matches the MCP request body limit.
const crewCommandInputLimit = mcpInputLimit

// crewCommandUsage lists the CLI work commands and their argument forms.
var crewCommandUsage = map[string]string{
	"read":       "read JSON|-",
	"search":     "search JSON|-",
	"schema":     "schema",
	"query":      "query JSON|-",
	"write":      "write JSON|- [--file PATH]...",
	"attach":     "attach FILE... (--task ID | --note ID) --reported-agent NAME [--reason TEXT] [--execution JSON]",
	"attachment": "attachment ID --out FILE|DIR [--variant original|preview|card|text]",
}

// crewFileActions accept files (write --file).
var crewFileActions = map[string]bool{"attachment.add": true, "task.create": true, "note.create": true}

// prepareCrewCommand validates a work command's input before any server is
// started or contacted, and returns the request to send.
func prepareCrewCommand(command string, a *args) (*crewRequest, error) {
	usage := crewCommandUsage[command]
	switch command {
	case "attach":
		cmd, err := prepareAttach(a)
		if err != nil {
			return nil, err
		}
		a.work = cmd.run
		return nil, nil
	case "attachment":
		cmd, err := prepareDownload(a)
		if err != nil {
			return nil, err
		}
		a.work = cmd.run
		return nil, nil
	}
	if command == "schema" {
		if err := a.need(0, usage); err != nil {
			return nil, err
		}
		r := crewSchemaRequest()
		return &r, nil
	}
	if err := a.need(1, usage); err != nil {
		return nil, err
	}
	if command != "write" && len(a.lists["file"]) > 0 {
		return nil, fail(2, "usage: pocketcontext-crew %s", usage)
	}
	raw, err := readCrewInput(command, a.pos[0])
	if err != nil {
		return nil, err
	}
	var r crewRequest
	switch command {
	case "read":
		var in crewRead
		if in, err = decodeCrewInput[crewRead](command, raw); err == nil {
			r = in.request()
		}
	case "search":
		var in crewSearch
		if in, err = decodeCrewInput[crewSearch](command, raw); err == nil {
			r = in.request()
		}
	case "query":
		var in crewQuery
		if in, err = decodeCrewInput[crewQuery](command, raw); err == nil {
			if r, err = in.request(); errors.Is(err, errCrewSQLTooLong) {
				err = fail(2, "query: %v", err)
			}
		}
	case "write":
		var in crewWrite
		if in, err = decodeCrewInput[crewWrite](command, raw); err == nil {
			r = in.request()
			if paths := a.lists["file"]; len(paths) > 0 {
				r.files, err = writeFiles(in, paths)
			}
		}
	default:
		return nil, fail(2, "unknown command %q", command)
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// readCrewInput returns the JSON argument, or standard input for "-".
func readCrewInput(command, text string) ([]byte, error) {
	if text != "-" {
		if strings.TrimSpace(text) == "" {
			return nil, fail(2, "%s: the JSON input is empty", command)
		}
		if len(text) > crewCommandInputLimit {
			return nil, fail(2, "%s: the JSON input exceeds %d bytes", command, crewCommandInputLimit)
		}
		return []byte(text), nil
	}
	data, err := io.ReadAll(io.LimitReader(os.Stdin, crewCommandInputLimit+1))
	if err != nil {
		return nil, fail(2, "%s: reading standard input: %v", command, err)
	}
	if len(data) > crewCommandInputLimit {
		return nil, fail(2, "%s: the JSON input exceeds %d bytes", command, crewCommandInputLimit)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, fail(2, "%s: standard input is empty; write one JSON object to it", command)
	}
	return data, nil
}

// decodeCrewInput checks one JSON object against the schema the MCP SDK infers
// for the tool's input type (required fields, types and no unknown fields),
// then decodes it like the SDK does.
func decodeCrewInput[T any](command string, raw []byte) (T, error) {
	var zero T
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var value any
	if err := decoder.Decode(&value); err != nil {
		return zero, fail(2, "%s: the input is not valid JSON: %v", command, err)
	}
	if _, err := decoder.Token(); err != io.EOF {
		return zero, fail(2, "%s: the input must be exactly one JSON object", command)
	}
	object, ok := value.(map[string]any)
	if !ok {
		return zero, fail(2, "%s: the input must be a JSON object", command)
	}
	schema, err := jsonschema.ForType(reflect.TypeFor[T](), &jsonschema.ForOptions{})
	if err != nil {
		return zero, err
	}
	resolved, err := schema.Resolve(&jsonschema.ResolveOptions{ValidateDefaults: true})
	if err != nil {
		return zero, err
	}
	var validated any = object
	if err := resolved.ApplyDefaults(&validated); err != nil {
		return zero, fail(2, "%s: invalid input: %v", command, err)
	}
	if err := resolved.Validate(&validated); err != nil {
		return zero, fail(2, "%s: invalid input: %v", command, err)
	}
	normalized, err := json.Marshal(validated)
	if err != nil {
		return zero, err
	}
	strict := json.NewDecoder(bytes.NewReader(normalized))
	strict.DisallowUnknownFields()
	var out T
	if err := strict.Decode(&out); err != nil {
		return zero, fail(2, "%s: invalid input: %v", command, err)
	}
	return out, nil
}

// writeFiles checks write --file files: only for actions that take files,
// never together with base64 data.files, and within one multipart request.
// attachment:new-N in task.create/note.create names the Nth --file.
func writeFiles(in crewWrite, paths []string) ([]crewFile, error) {
	if !crewFileActions[in.Action] {
		return nil, fail(2, "write: --file works only with attachment.add, task.create and note.create")
	}
	if _, ok := in.Data["files"]; ok {
		return nil, fail(2, "write: use either --file or data.files, not both")
	}
	files, err := checkCrewFiles("write", paths)
	if err != nil {
		return nil, err
	}
	var total int64
	for _, f := range files {
		total += f.size
	}
	if total > crewMultipartBudget {
		return nil, fail(2, "write: the files exceed 89 MiB in one request; create first, then use attach")
	}
	return files, nil
}
