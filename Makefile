.PHONY: test lint check install uninstall dev help

PLUGIN_NAME := ligamen
PLUGIN_DIR  := $(shell pwd)
BATS        := ./tests/bats/bin/bats

help: ## Show available targets
	@grep -E '^[a-z][a-z_-]+:.*##' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

test: ## Run all bats tests
	$(BATS) tests/*.bats

lint: ## Shellcheck scripts and libs
	shellcheck -x -e SC1091 scripts/*.sh lib/*.sh

check: ## Validate plugin.json and hooks.json
	jq empty .claude-plugin/plugin.json
	jq empty hooks/hooks.json
	@echo "JSON valid"

install: plugins/$(PLUGIN_NAME) ## Register marketplace and install plugin
	claude plugin marketplace add $(PLUGIN_DIR)
	claude plugin install $(PLUGIN_NAME)@$(PLUGIN_NAME) --scope user

plugins/$(PLUGIN_NAME):
	mkdir -p plugins
	ln -sfn $(PLUGIN_DIR) plugins/$(PLUGIN_NAME)

uninstall: ## Remove plugin and marketplace registration
	claude plugin uninstall $(PLUGIN_NAME)@$(PLUGIN_NAME) || true
	claude plugin marketplace remove $(PLUGIN_DIR) || true

dev: ## Launch Claude Code with this plugin loaded (no install)
	claude --plugin-dir $(PLUGIN_DIR)
