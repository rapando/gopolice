package main

import (
	"io/fs"

	"github.com/rapando/gopolice/cmd"
)

func main() {
	uifs, _ := fs.Sub(UIFS, "ui/dist")
	cmd.Execute(uifs)
}
