package cmd

import (
	"io/fs"
	"os"

	"github.com/spf13/cobra"
)

var uiFS fs.FS

func NewRootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:   "gopolice",
		Short: "A web UI reporting tool for Go projects",
		Long: `gopolice scans Go projects for code quality, security, logical issues,
performance profiling, tests and git blame, then opens an interactive web UI.`,
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			return nil
		},
	}

	root.PersistentFlags().Bool("config", false, "Open config editor in web UI")
	root.AddCommand(NewVersionCommand())
	root.AddCommand(NewConfigCommand())
	root.AddCommand(NewScanCommand())
	root.AddCommand(NewServeCommand())
	root.AddCommand(NewHistoryCommand())

	return root
}

func Execute(uifs fs.FS) {
	uiFS = uifs
	if err := NewRootCommand().Execute(); err != nil {
		os.Exit(1)
	}
}
