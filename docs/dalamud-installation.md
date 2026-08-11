# Installing the Dalamud controller

Tournament Bracket Controller is distributed through the project custom Dalamud repository. It is a third-party custom repository, not the official Dalamud plugin repository. Only install it if you trust the project and its release process.

## One-time repository setup

After GitHub Pages has been enabled and the first `v*` release workflow has succeeded, add this exact repository URL in Dalamud:

`https://KeiJoi.github.io/tournamentcontrol/repository.json`

1. In FFXIV, open Dalamud Settings with `/xlsettings`.
2. Open the **Experimental** tab and find **Custom Plugin Repositories**.
3. Paste the URL above, add it, and save/apply the settings.
4. Open the Plugin Installer, search for **Tournament Bracket Controller**, and install it.
5. Open the controller with `/tourney` and configure the server connection.

The current entry is visible through a custom repository but is not marked testing-exclusive, so no additional testing toggle is required. If a later testing-only build is published, its release notes will state the required opt-in.

## Updating and removing

Dalamud checks the repository metadata and downloads a newer SDK-generated package when its assembly version changes. To update, use the Plugin Installer update flow after a new release is published. To remove the plugin, uninstall it from the Plugin Installer; optionally remove the custom repository URL from Dalamud Settings afterwards.

## Release workflow

`apps/dalamud/TournamentControl.Dalamud.csproj` is the authoritative plugin version source. For a release, update `<Version>`, run the full checks, and create a matching `vX.Y.Z` tag. The GitHub workflow verifies the tag/version match, tests and builds with the installed `DalamudPackager`, validates the generated ZIP, creates a GitHub Release, and publishes fresh `repository.json` metadata to GitHub Pages.

For setup of GitHub Pages and the complete release checklist, see [releasing](releasing.md). No release is created by ordinary pushes or pull requests.
