package cmd

import (
	"fmt"

	"github.com/rapando/gopolice/internal/config"
	"github.com/spf13/cobra"
)

func NewConfigCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage gopolice configuration",
	}

	cmd.AddCommand(&cobra.Command{
		Use:   "init",
		Short: "Create default configuration files",
		RunE: func(c *cobra.Command, args []string) error {
			if err := config.InitGlobalConfig(); err != nil {
				return fmt.Errorf("failed to init global config: %w", err)
			}
			c.PrintErr("Global config initialized at ", config.GlobalConfigPath(), "\n")

			if config.IsInsideGoProject() {
				if err := config.InitProjectConfig(); err != nil {
					return fmt.Errorf("failed to init project config: %w", err)
				}
				c.PrintErr("Project config initialized at ", config.ProjectConfigPath(), "\n")
			}
			return nil
		},
	})

	cmd.AddCommand(&cobra.Command{
		Use:   "show",
		Short: "Display the merged configuration",
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
	})

	return cmd
}
