package cmd

import (
	"runtime/debug"

	"github.com/spf13/cobra"
)

var Version = "dev"

func GetVersion() string {
	if Version != "dev" {
		return Version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" {
		return info.Main.Version
	}
	return "dev"
}

func NewVersionCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version number",
		Run: func(c *cobra.Command, args []string) {
			c.Println(GetVersion())
		},
	}
}
