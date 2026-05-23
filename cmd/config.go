package cmd

import (
	"fmt"

	"github.com/rapando/gopolice/internal/config"
	"github.com/spf13/cobra"
)

func NewConfigCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "config",
		Short: "Display the current configuration",
		RunE: func(c *cobra.Command, args []string) error {
			cfg, err := config.DefaultLoadConfig()
			if err != nil {
				return fmt.Errorf("failed to load config: %w", err)
			}
			out, err := config.Marshal(cfg)
			if err != nil {
				return fmt.Errorf("failed to marshal config: %w", err)
			}
			c.Print(string(out))
			return nil
		},
	}
}
