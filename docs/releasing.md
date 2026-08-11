# Releasing the Dalamud plugin

This project uses the supported `DalamudPackager` brought in by `Dalamud.NET.Sdk`. Its generated `bin/Release/TournamentControl.Dalamud/latest.zip` is the only archive published; do not construct a second hand-made plugin ZIP.

## One-time GitHub Pages setup

1. In the GitHub repository, open **Settings → Pages**.
2. Set the source to **GitHub Actions** and save it.
3. Ensure the repository is public if the plugin should be installable by users without GitHub credentials.
4. After the first tagged release finishes, verify that `https://KeiJoi.github.io/tournamentcontrol/repository.json` returns a JSON array over HTTPS.

The release job has only the permissions needed to create a release and deploy Pages. It runs only for a pushed `v*` tag; pull requests and normal pushes only build, test, package, and upload a private workflow artifact.

## Release procedure

1. Update `<Version>` in `apps/dalamud/TournamentControl.Dalamud.csproj`. It must be a three-part stable semantic version such as `0.1.1`.
2. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `dotnet test apps/dalamud.tests/TournamentControl.Dalamud.Tests.csproj --configuration Release`, and `dotnet build apps/dalamud/TournamentControl.Dalamud.csproj --configuration Release`.
3. Review the generated manifest and SDK package. `scripts/verify-dalamud-package.ps1` validates the required DLL, `.deps.json`, manifest, API level, internal name, and assembly version.
4. Create and push an exact matching annotated tag, for example `v0.1.1` for `<Version>0.1.1</Version>`. The workflow refuses a mismatch.
5. Confirm the GitHub Release contains `TournamentBracketController-v0.1.1.zip`, and confirm the Pages deployment has updated `repository.json` with the matching release URLs and a Unix `LastUpdate` value.
6. Install/update from a separate Dalamud test profile before announcing the release.

Do not use a tag to bypass testing, and do not place secrets, credentials, or production configuration in release assets or metadata.
