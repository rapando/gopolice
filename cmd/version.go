package cmd

import (
	"github.com/spf13/cobra"
)

var Version = "dev"

func NewVersionCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the version number",
		Run: func(c *cobra.Command, args []string) {
			c.Println(Version)
		},
	}
}
