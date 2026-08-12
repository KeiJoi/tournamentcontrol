using Dalamud.Bindings.ImGui;
using Dalamud.Interface.Windowing;
using TournamentControl.Dalamud.Services;

namespace TournamentControl.Dalamud.Windows;

public sealed class MainWindow : Window, IDisposable
{
    private readonly Configuration configuration; private readonly TournamentApiClient api; private readonly MatchCalloutService callouts;
    private string serverUrl; private string serverPassword = ""; private string userKey = ""; private string connectionStatus = "Not tested."; private bool showSecrets; private bool previewOpen; private bool confirmCreateOrganizer; private string previewPlayerOne = "Tom"; private string previewPlayerTwo = "Jerry";
    private string search = ""; private string eventDateFilter = ""; private int statusFilter; private bool newestFirst = true; private List<ControllerTournament> tournaments = []; private string browserStatus = "Authenticate to load tournaments."; private bool loading;
    private string venueName = ""; private string gameName = ""; private string tournamentName = ""; private string eventDate = DateTimeOffset.Now.ToString("yyyy-MM-ddTHH:mm:ss.fffzzz"); private string createStatus = ""; private bool showCreate;
    private ControllerState? selectedState; private string singlePlayer = ""; private string bulkPlayers = ""; private string controllerStatus = ""; private bool confirmRandomize; private bool confirmStart; private string? draggedContestantId; private (string MatchId, string WinnerId)? pendingWinner;

    public MainWindow(Configuration configuration, TournamentApiClient api, MatchCalloutService callouts) : base("Tournament Bracket Controller") { this.configuration = configuration; this.api = api; this.callouts = callouts; serverUrl = configuration.ServerUrl; }
    public override void Draw()
    {
        if (ImGui.BeginTabBar("controller-tabs")) { if (ImGui.BeginTabItem("Tournament Controller")) { DrawBrowser(); ImGui.EndTabItem(); } if (ImGui.BeginTabItem("Setup & Callouts")) { DrawSetup(); ImGui.EndTabItem(); } ImGui.EndTabBar(); }
    }
    private void DrawBrowser()
    {
        if (selectedState is not null) { DrawSeedingController(); return; }
        ImGui.TextUnformatted("TOURNAMENT CONTROLLER"); ImGui.SameLine(); ImGui.TextDisabled(api.HasValidSession ? "Connected: " + serverUrl : "Not authenticated");
        if (!api.HasValidSession) { ImGui.TextWrapped("Authenticate on Setup & Callouts before loading your tournaments."); return; }
        ImGui.InputTextWithHint("##search", "Search tournaments…", ref search, 256); ImGui.SameLine(); if (ImGui.Button("Refresh")) _ = LoadAsync(); ImGui.InputTextWithHint("##event-date", "Event date filter (YYYY-MM-DD)", ref eventDateFilter, 32);
        ImGui.Combo("Status", ref statusFilter, new[] { "All", "SETUP", "ACTIVE", "COMPLETED", "CANCELLED" }, 5); ImGui.SameLine(); ImGui.Checkbox("Newest first", ref newestFirst); ImGui.TextDisabled(browserStatus); ImGui.Separator();
        IEnumerable<ControllerTournament> filtered = tournaments.Where(Filter).OrderBy(item => item.EventDate); if (newestFirst) filtered = filtered.Reverse(); foreach (var item in filtered) DrawTournament(item);
        ImGui.Separator(); if (ImGui.Button("+ Create Tournament")) showCreate = !showCreate; if (showCreate) DrawCreate();
    }
    private bool Filter(ControllerTournament item) => (statusFilter == 0 || item.Status == new[] { "All", "SETUP", "ACTIVE", "COMPLETED", "CANCELLED" }[statusFilter]) && (string.IsNullOrWhiteSpace(eventDateFilter) || item.EventDate.ToString("yyyy-MM-dd").Contains(eventDateFilter, StringComparison.OrdinalIgnoreCase));
    private void DrawTournament(ControllerTournament item)
    {
        ImGui.TextColored(new System.Numerics.Vector4(1f, .48f, .1f, 1f), item.VenueName); ImGui.TextUnformatted(item.TournamentName); ImGui.TextDisabled(item.GameName + " · " + item.EventDate.LocalDateTime.ToString("g") + " · " + item.Status + " · " + item.PlayerCount + " Players");
        var link = PublicUrl(item.PublicCode); ImGui.TextDisabled(link); ImGui.SameLine(); if (ImGui.SmallButton("Copy Link##" + item.Id)) ImGui.SetClipboardText(link); ImGui.SameLine(); if (ImGui.SmallButton("Control##" + item.Id)) _ = OpenControllerAsync(item.Id); ImGui.Separator();
    }
    private void DrawCreate()
    {
        ImGui.TextUnformatted("CREATE TOURNAMENT"); ImGui.InputText("Venue Name", ref venueName, 200); ImGui.InputText("Game Name", ref gameName, 200); ImGui.InputText("Tournament Name", ref tournamentName, 200); ImGui.InputText("Event Date (ISO 8601)", ref eventDate, 64); ImGui.TextDisabled("Bracket Format: Single Elimination"); if (ImGui.Button("Create")) _ = CreateAsync(); ImGui.SameLine(); if (ImGui.Button("Cancel")) showCreate = false; if (!string.IsNullOrEmpty(createStatus)) ImGui.TextWrapped(createStatus);
    }
    private void DrawSeedingController()
    {
        var state = selectedState!; ImGui.TextUnformatted("TOURNAMENT SEEDING"); ImGui.SameLine(); if (ImGui.SmallButton("Back to browser")) { selectedState = null; return; } ImGui.TextUnformatted(state.Tournament.TournamentName + " · Revision " + state.Tournament.Revision); ImGui.TextDisabled(state.Tournament.Status + " · " + state.Contestants.Count + " Players");
        if (state.Tournament.Status != "SETUP") { DrawActiveController(state); return; }
        ImGui.InputText("Player Name", ref singlePlayer, 200); ImGui.SameLine(); if (ImGui.Button("Add") || (ImGui.IsItemHovered() && ImGui.IsKeyPressed(ImGuiKey.Enter))) _ = AddSingleAsync();
        ImGui.InputTextMultiline("Bulk entry", ref bulkPlayers, 16000, new System.Numerics.Vector2(-1, 90)); if (ImGui.Button("Add Bulk Entries")) _ = BulkAddAsync(); ImGui.TextDisabled(controllerStatus); ImGui.Separator();
        foreach (var player in state.Contestants.OrderBy(item => item.Seed).ToList()) DrawContestant(player);
        ImGui.Separator(); ImGui.Checkbox("Confirm randomize arranged seeds", ref confirmRandomize); if (!confirmRandomize) ImGui.BeginDisabled(); if (ImGui.Button("Randomize Seeds")) _ = RandomizeAsync(); if (!confirmRandomize) ImGui.EndDisabled();
        ImGui.Checkbox("I understand the bracket will be generated from this final seed order", ref confirmStart); if (!confirmStart) ImGui.BeginDisabled(); if (ImGui.Button("START TOURNAMENT")) _ = StartAsync(); if (!confirmStart) ImGui.EndDisabled();
    }
    private void DrawContestant(ControllerContestant player)
    {
        var name = player.DisplayName; ImGui.PushID(player.Id); ImGui.TextUnformatted("#" + player.Seed); ImGui.SameLine(); if (ImGui.InputText("##name", ref name, 200) && name != player.DisplayName) _ = RenameAsync(player.Id, name); ImGui.SameLine(); if (ImGui.SmallButton("Remove")) _ = RemoveAsync(player.Id);
        if (ImGui.BeginDragDropSource()) { draggedContestantId = player.Id; ImGui.SetDragDropPayload("tourney-contestant", ReadOnlySpan<byte>.Empty); ImGui.TextUnformatted("Move " + player.DisplayName); ImGui.EndDragDropSource(); }
        if (ImGui.BeginDragDropTarget()) { if (draggedContestantId is not null && ImGui.IsMouseReleased(ImGuiMouseButton.Left) && draggedContestantId != player.Id) _ = MoveBeforeAsync(draggedContestantId, player.Id); ImGui.EndDragDropTarget(); } ImGui.PopID();
    }
    private void DrawActiveController(ControllerState state)
    {
        var people = state.Contestants.ToDictionary(item => item.Id); ImGui.TextColored(new System.Numerics.Vector4(.7f, 1f, .2f, 1f), "LIVE MATCH CONTROL"); ImGui.TextDisabled(controllerStatus);
        foreach (var match in state.Matches.OrderBy(item => item.Status is "READY" or "IN_PROGRESS" ? 0 : item.WinnerId is not null ? 1 : 2).ThenBy(item => item.Position))
        {
            people.TryGetValue(match.Player1Id ?? "", out var first); people.TryGetValue(match.Player2Id ?? "", out var second); ImGui.Separator(); ImGui.TextUnformatted("MATCH " + match.Position + " · " + match.Status); ImGui.TextUnformatted((first is null ? "—" : "#" + first.Seed + " " + first.DisplayName) + "  vs  " + (second is null ? "—" : "#" + second.Seed + " " + second.DisplayName));
            var unresolved = match.Status is "READY" or "IN_PROGRESS" && first is not null && second is not null;
            if (unresolved) { var playerOne = first!; var playerTwo = second!; var plan = CalloutTemplate.CreatePlan(configuration.CalloutLine1, configuration.CalloutLine2, configuration.CalloutDelayMilliseconds, playerOne.DisplayName, playerTwo.DisplayName); string? calloutReason = null; var canCall = plan.IsValid; if (canCall) canCall = callouts.CanSend(match.Id, out calloutReason); if (!canCall) ImGui.BeginDisabled(); ImGui.PushStyleColor(ImGuiCol.Button, new System.Numerics.Vector4(.86f, .16f, .57f, 1f)); if (ImGui.Button(callouts.IsSending(match.Id) ? "SENDING CALLOUT...##" + match.Id : "CALL PLAYERS##" + match.Id, new System.Numerics.Vector2(-1, 0))) callouts.TrySend(match.Id, configuration.CalloutChannel, configuration.CalloutLine1, configuration.CalloutLine2, configuration.CalloutDelayMilliseconds, playerOne.DisplayName, playerTwo.DisplayName); ImGui.PopStyleColor(); if (!canCall) ImGui.EndDisabled(); var calloutStatus = callouts.GetStatus(match.Id) ?? (plan.IsValid ? calloutReason : plan.First.Error ?? plan.Second.Error ?? "Configure at least one callout line first."); if (!string.IsNullOrEmpty(calloutStatus)) ImGui.TextDisabled(calloutStatus); if (ImGui.Button(playerOne.DisplayName + " Wins##" + match.Id)) pendingWinner = (match.Id, playerOne.Id); ImGui.SameLine(); if (ImGui.Button(playerTwo.DisplayName + " Wins##" + match.Id)) pendingWinner = (match.Id, playerTwo.Id); }
            else if (match.WinnerId is not null && first is not null && second is not null) { ImGui.TextColored(new System.Numerics.Vector4(.7f, 1f, .2f, 1f), "Winner: " + (match.WinnerId == first.Id ? first.DisplayName : second.DisplayName)); if (ImGui.SmallButton("Correct Result##" + match.Id)) pendingWinner = (match.Id, match.WinnerId == first.Id ? second.Id : first.Id); }
        }
        if (pendingWinner is { } choice) { ImGui.Separator(); ImGui.TextColored(new System.Numerics.Vector4(1f, .5f, .1f, 1f), "Confirm selected winner?"); if (ImGui.Button("Confirm Result")) _ = SubmitWinnerAsync(choice.MatchId, choice.WinnerId); ImGui.SameLine(); if (ImGui.Button("Cancel Result")) pendingWinner = null; }
        ImGui.Separator(); if (ImGui.Button("Copy Public Bracket URL")) ImGui.SetClipboardText(PublicUrl(state.Tournament.PublicCode));
    }
    private void DrawSetup()
    {
        ImGui.TextUnformatted("SERVER CONNECTION"); ImGui.Separator(); ImGui.InputText("Server URL", ref serverUrl, 512); ImGui.Checkbox("Show passwords", ref showSecrets); var flags = showSecrets ? ImGuiInputTextFlags.None : ImGuiInputTextFlags.Password; ImGui.InputText("Admin Password", ref serverPassword, 512, flags); ImGui.InputText("User Password / Key", ref userKey, 512, flags);
        if (Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttp && uri.Host is not "localhost" and not "127.0.0.1") ImGui.TextColored(new System.Numerics.Vector4(1f, .48f, .1f, 1f), "Warning: use HTTPS outside localhost."); if (ImGui.Button("Test Connection")) _ = TestConnectionAsync(); ImGui.SameLine(); if (ImGui.Button("Save")) SaveConnection(); ImGui.TextUnformatted(connectionStatus); ImGui.Checkbox("I intentionally want to create an organizer with this user key", ref confirmCreateOrganizer); if (!confirmCreateOrganizer) ImGui.BeginDisabled(); if (ImGui.Button("Create Organizer Using This User Key")) _ = CreateOrganizerAsync(); if (!confirmCreateOrganizer) ImGui.EndDisabled();
        DrawCalloutSettings();
    }
    private void DrawCalloutSettings()
    {
        ImGui.Separator(); ImGui.TextUnformatted("MATCH CALLOUT SETTINGS");
        var changed = false; var channel = (int)configuration.CalloutChannel;
        if (ImGui.Combo("Chat Channel", ref channel, new[] { "Shout", "Yell" }, 2)) { configuration.CalloutChannel = (CalloutChannel)channel; changed = true; }
        var line1 = configuration.CalloutLine1; if (ImGui.InputTextMultiline("Line 1", ref line1, 512, new System.Numerics.Vector2(-1, 48))) { configuration.CalloutLine1 = line1; changed = true; }
        var line2 = configuration.CalloutLine2; if (ImGui.InputTextMultiline("Line 2", ref line2, 512, new System.Numerics.Vector2(-1, 48))) { configuration.CalloutLine2 = line2; changed = true; }
        var seconds = configuration.CalloutDelayMilliseconds / 1000f; if (ImGui.SliderFloat("Delay Between Lines (seconds)", ref seconds, .5f, 10f, "%.1f")) { configuration.CalloutDelayMilliseconds = (int)(seconds * 1000); changed = true; }
        if (ImGui.Button("Reset Callout Defaults")) { configuration.CalloutChannel = CalloutChannel.Shout; configuration.CalloutLine1 = "WILL <1> and <2> COME ON DOWN!"; configuration.CalloutLine2 = "You are the next victims in this tournament!"; configuration.CalloutDelayMilliseconds = 2000; changed = true; }
        if (changed) configuration.Save();
        ImGui.TextUnformatted("<1> = first player in match    <2> = second player in match");
        ImGui.TextDisabled("Templates are stored locally and are sent only when the operator presses CALL PLAYERS. Placeholders are replaced at send time.");
        ImGui.InputText("Player One", ref previewPlayerOne, 200); ImGui.InputText("Player Two", ref previewPlayerTwo, 200);
        var preview = CalloutTemplate.CreatePlan(configuration.CalloutLine1, configuration.CalloutLine2, configuration.CalloutDelayMilliseconds, previewPlayerOne, previewPlayerTwo);
        DrawCalloutLength("Line 1 expanded", preview.First); DrawCalloutLength("Line 2 expanded", preview.Second);
        if (ImGui.Button("Preview (does not send chat)")) previewOpen = !previewOpen;
        if (previewOpen)
        {
            var command = CalloutTemplate.Command(configuration.CalloutChannel);
            if (preview.First.Text is { } first) ImGui.TextWrapped(command + " " + first);
            if (preview.First.HasMessage && preview.Second.HasMessage) ImGui.TextUnformatted("(wait " + preview.Delay.TotalSeconds.ToString("0.0") + " seconds)");
            if (preview.Second.Text is { } second) ImGui.TextWrapped(command + " " + second);
            if (!preview.HasMessages) ImGui.TextDisabled("Both lines are blank; no callout will be sent.");
        }
        ImGui.Separator(); ImGui.TextWrapped("Anyone with this shared server password and user key can control this organizer. Credentials are stored in local Dalamud plugin configuration.");
    }
    private static void DrawCalloutLength(string label, CalloutLine line)
    {
        var text = label + ": " + line.ExpandedLength + "/" + CalloutTemplate.MaximumMessageLength;
        if (line.Error is null) ImGui.TextDisabled(text); else ImGui.TextColored(new System.Numerics.Vector4(1f, .35f, .25f, 1f), text + " — " + line.Error);
    }
    private async Task LoadAsync() { if (loading) return; loading = true; browserStatus = "Loading…"; try { tournaments = (await api.ListTournamentsAsync(search, statusFilter == 0 ? null : new[] { "All", "SETUP", "ACTIVE", "COMPLETED", "CANCELLED" }[statusFilter], CancellationToken.None)).ToList(); browserStatus = "Loaded " + tournaments.Count + " tournaments."; } catch (UnauthorizedAccessException) { browserStatus = "Session expired. Authenticate again."; } catch { browserStatus = "Could not load tournaments. Retrying after reconnect is safe."; } finally { loading = false; } }
    private async Task CreateAsync() { if (!DateTimeOffset.TryParse(eventDate, out var date) || string.IsNullOrWhiteSpace(venueName) || string.IsNullOrWhiteSpace(gameName) || string.IsNullOrWhiteSpace(tournamentName)) { createStatus = "Venue, game, tournament name, and valid ISO event date are required."; return; } try { var created = await api.CreateTournamentAsync(new CreateTournamentRequest(venueName.Trim(), gameName.Trim(), tournamentName.Trim(), date), CancellationToken.None); createStatus = "Created: " + created.PublicUrl; ImGui.SetClipboardText(created.PublicUrl); showCreate = false; await LoadAsync(); } catch (UnauthorizedAccessException) { createStatus = "Session expired. Authenticate again."; } catch { createStatus = "Creation failed; check server validation and connection."; } }
    private async Task OpenControllerAsync(string tournamentId) { controllerStatus = "Loading authoritative state…"; try { selectedState = await api.GetStateAsync(tournamentId, CancellationToken.None); controllerStatus = ""; } catch { controllerStatus = "Could not load tournament state."; } }
    private async Task SubmitWinnerAsync(string matchId, string winnerId) { if (selectedState is null) return; try { var match = selectedState.Matches.First(item => item.Id == matchId); selectedState = match.WinnerId is null ? await api.RecordWinnerAsync(selectedState.Tournament.Id, matchId, selectedState.Tournament.Revision, winnerId, CancellationToken.None) : await api.CorrectAsync(selectedState.Tournament.Id, matchId, selectedState.Tournament.Revision, winnerId, false, CancellationToken.None); pendingWinner = null; controllerStatus = "Result saved from authoritative server state."; } catch { await RefreshAfterConflictAsync(); controllerStatus = "Result conflict or unsafe correction; state refreshed."; } }
    private async Task AddSingleAsync() { if (string.IsNullOrWhiteSpace(singlePlayer) || selectedState is null) return; try { selectedState = await api.AddContestantAsync(selectedState.Tournament.Id, selectedState.Tournament.Revision, singlePlayer.Trim(), CancellationToken.None); singlePlayer = ""; } catch { await RefreshAfterConflictAsync(); } }
    private async Task BulkAddAsync() { if (string.IsNullOrWhiteSpace(bulkPlayers) || selectedState is null) return; try { selectedState = await api.BulkAddAsync(selectedState.Tournament.Id, selectedState.Tournament.Revision, bulkPlayers, CancellationToken.None); bulkPlayers = ""; } catch { await RefreshAfterConflictAsync(); } }
    private async Task RenameAsync(string id, string name) { if (selectedState is null || string.IsNullOrWhiteSpace(name)) return; try { selectedState = await api.RenameContestantAsync(selectedState.Tournament.Id, id, selectedState.Tournament.Revision, name.Trim(), CancellationToken.None); } catch { await RefreshAfterConflictAsync(); } }
    private async Task RemoveAsync(string id) { if (selectedState is null) return; try { selectedState = await api.RemoveContestantAsync(selectedState.Tournament.Id, id, selectedState.Tournament.Revision, CancellationToken.None); } catch { await RefreshAfterConflictAsync(); } }
    private async Task MoveBeforeAsync(string sourceId, string targetId) { if (selectedState is null) return; var ids = selectedState.Contestants.OrderBy(item => item.Seed).Select(item => item.Id).ToList(); ids.Remove(sourceId); ids.Insert(ids.IndexOf(targetId), sourceId); draggedContestantId = null; try { selectedState = await api.ReorderAsync(selectedState.Tournament.Id, selectedState.Tournament.Revision, ids, CancellationToken.None); } catch { await RefreshAfterConflictAsync(); } }
    private async Task RandomizeAsync() { if (selectedState is null) return; try { selectedState = await api.RandomizeAsync(selectedState.Tournament.Id, selectedState.Tournament.Revision, CancellationToken.None); confirmRandomize = false; } catch { await RefreshAfterConflictAsync(); } }
    private async Task StartAsync() { if (selectedState is null) return; try { selectedState = await api.StartAsync(selectedState.Tournament.Id, selectedState.Tournament.Revision, CancellationToken.None); confirmStart = false; controllerStatus = "Tournament started. Active controller is ready for results."; } catch { await RefreshAfterConflictAsync(); } }
    private async Task RefreshAfterConflictAsync() { if (selectedState is null) return; try { selectedState = await api.GetStateAsync(selectedState.Tournament.Id, CancellationToken.None); controllerStatus = "State changed on another controller; refreshed from server."; } catch { controllerStatus = "Could not reconcile with server."; } }
    private async Task TestConnectionAsync() { connectionStatus = "Testing…"; try { api.ConfigureServer(serverUrl); var password = string.IsNullOrEmpty(serverPassword) ? configuration.ServerAccessPassword : serverPassword; var key = string.IsNullOrEmpty(userKey) ? configuration.UserKey : userKey; if (!string.IsNullOrEmpty(password) && !string.IsNullOrEmpty(key)) { await api.AuthenticateAsync(password, key, CancellationToken.None); connectionStatus = "Authenticated. Session is active."; _ = LoadAsync(); } else connectionStatus = await api.IsHealthyAsync(CancellationToken.None) ? "Server is reachable. Enter credentials to authenticate." : "Server did not report healthy."; } catch (UnauthorizedAccessException) { connectionStatus = "Credentials were rejected. Organizer creation is a separate deliberate action."; } catch (HttpRequestException exception) { TournamentControl.Dalamud.Plugin.Log.Warning(exception, "Tournament server request failed; no credentials were logged."); connectionStatus = exception.StatusCode is { } status ? "Server request failed (HTTP " + (int)status + "). Check the server response." : "Network/TLS request failed. Check the Dalamud plugin log for details."; } catch (Exception exception) { TournamentControl.Dalamud.Plugin.Log.Warning(exception, "Tournament server authentication failed; no credentials were logged."); connectionStatus = "Connection setup failed (" + exception.GetType().Name + "). Check the Dalamud plugin log."; } }
    private async Task CreateOrganizerAsync() { connectionStatus = "Creating organizer…"; try { api.ConfigureServer(serverUrl); var password = string.IsNullOrEmpty(serverPassword) ? configuration.ServerAccessPassword : serverPassword; var key = string.IsNullOrEmpty(userKey) ? configuration.UserKey : userKey; if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(key)) { connectionStatus = "Enter the server password and user key first."; return; } await api.CreateOrganizerAsync(password, key, CancellationToken.None); connectionStatus = "Organizer created and authenticated."; confirmCreateOrganizer = false; _ = LoadAsync(); } catch (HttpRequestException exception) { TournamentControl.Dalamud.Plugin.Log.Warning(exception, "Organizer creation request failed; no credentials were logged."); connectionStatus = exception.StatusCode is { } status ? "Organizer creation failed (HTTP " + (int)status + ")." : "Organizer request failed; check the Dalamud plugin log."; } catch (Exception exception) { TournamentControl.Dalamud.Plugin.Log.Warning(exception, "Organizer creation failed; no credentials were logged."); connectionStatus = "Organizer creation failed (" + exception.GetType().Name + "). Check the Dalamud plugin log."; } }
    private void SaveConnection() { if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out _)) { connectionStatus = "Enter a valid absolute server URL."; return; } configuration.ServerUrl = serverUrl.TrimEnd('/'); if (!string.IsNullOrEmpty(serverPassword)) configuration.ServerAccessPassword = serverPassword; if (!string.IsNullOrEmpty(userKey)) configuration.UserKey = userKey; configuration.Save(); serverPassword = ""; userKey = ""; connectionStatus = "Saved locally."; }
    private string PublicUrl(string publicCode) => serverUrl.TrimEnd('/') + "/t/" + publicCode; public void Dispose() { callouts.Dispose(); api.Dispose(); }
}
