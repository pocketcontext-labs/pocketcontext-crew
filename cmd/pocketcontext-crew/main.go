// Command pocketcontext-crew is the PocketContext Crew server and client in one binary.
package main

import (
	"os"

	"github.com/pocketcontext-labs/pocketcontext-crew/internal/client"
)

func main() {
	os.Exit(client.Run(os.Args[1:]))
}
