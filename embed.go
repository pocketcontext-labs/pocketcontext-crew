// Package assets embeds the application files that the single
// pocketcontext-crew binary unpacks into its private cache before serving.
package assets

import "embed"

// Assets holds the hooks, migrations and built reader.
// Build the reader (ui/dist) before compiling.
//
//go:embed pb_hooks pb_migrations ui/dist
var Assets embed.FS

// Skill is the agent skill template that `pocketcontext-crew skill` installs with this
// computer's absolute paths.
//
//go:embed skills/pocketcontext-crew
var Skill embed.FS

// ManualSources embeds the exact release documentation. Export transforms it
// deterministically; there is no independently maintained documentation copy.
//
//go:embed README.md docs/crew.md docs/data-model.md docs/upgrades.md docs/reader-setup.md docs/service.md docs/https.md docs/mcp.md docs/local.md docs/hosting.md docs/releases/*.md
var ManualSources embed.FS
