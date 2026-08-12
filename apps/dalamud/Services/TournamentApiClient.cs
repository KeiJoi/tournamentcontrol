using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;

namespace TournamentControl.Dalamud.Services;

// Transport skeleton: authentication headers and concrete API calls are added with controller endpoints.
public sealed class TournamentApiClient(HttpClient httpClient) : IDisposable
{
    private string? accessToken;
    private Uri? serverUri;
    public DateTimeOffset? SessionExpiresAt { get; private set; }

    public void ConfigureServer(string serverUrl)
    {
        if (!Uri.TryCreate(serverUrl.TrimEnd('/') + "/", UriKind.Absolute, out var uri))
            throw new ArgumentException("Enter a valid absolute server URL.", nameof(serverUrl));
        serverUri = uri;
    }

    public async Task<bool> IsHealthyAsync(CancellationToken cancellationToken)
    {
        using var response = await httpClient.GetAsync(Endpoint("health"), cancellationToken);
        return response.IsSuccessStatusCode;
    }

    public async Task<SessionResponse> AuthenticateAsync(string serverPassword, string userKey, CancellationToken cancellationToken)
    {
        var response = await httpClient.PostAsJsonAsync(Endpoint("api/controller/sessions"), new { serverAccessPassword = serverPassword, userKey }, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedAccessException("Server password or user key was rejected.");
        response.EnsureSuccessStatusCode();
        var session = await response.Content.ReadFromJsonAsync<SessionResponse>(cancellationToken) ?? throw new InvalidOperationException("Server returned no session.");
        accessToken = session.AccessToken; SessionExpiresAt = session.ExpiresAt; return session;
    }

    public async Task<SessionResponse> CreateOrganizerAsync(string serverPassword, string userKey, CancellationToken cancellationToken)
    {
        var response = await httpClient.PostAsJsonAsync(Endpoint("api/controller/organizers"), new { serverAccessPassword = serverPassword, userKey }, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized) throw new UnauthorizedAccessException("Server password was rejected.");
        response.EnsureSuccessStatusCode();
        var session = await response.Content.ReadFromJsonAsync<SessionResponse>(cancellationToken) ?? throw new InvalidOperationException("Server returned no session.");
        accessToken = session.AccessToken; SessionExpiresAt = session.ExpiresAt; return session;
    }

    public void ClearSession() { accessToken = null; SessionExpiresAt = null; }
    public bool HasValidSession => !string.IsNullOrEmpty(accessToken) && SessionExpiresAt > DateTimeOffset.UtcNow;
    public async Task<IReadOnlyList<ControllerTournament>> ListTournamentsAsync(string? search, string? status, CancellationToken cancellationToken)
    {
        EnsureSession(); var query = new List<string>(); if (!string.IsNullOrWhiteSpace(search)) query.Add($"q={Uri.EscapeDataString(search)}"); if (!string.IsNullOrWhiteSpace(status) && status != "All") query.Add($"status={Uri.EscapeDataString(status)}");
        using var request = Authorized(HttpMethod.Get, "api/controller/tournaments" + (query.Count == 0 ? "" : "?" + string.Join("&", query))); using var response = await httpClient.SendAsync(request, cancellationToken); await ThrowIfExpiredAsync(response); return (await response.Content.ReadFromJsonAsync<TournamentListResponse>(cancellationToken))?.Tournaments ?? [];
    }
    public async Task<CreateTournamentResponse> CreateTournamentAsync(CreateTournamentRequest create, CancellationToken cancellationToken)
    {
        EnsureSession(); using var request = Authorized(HttpMethod.Post, "api/controller/tournaments"); request.Content = JsonContent.Create(create); using var response = await httpClient.SendAsync(request, cancellationToken); await ThrowIfExpiredAsync(response); return await response.Content.ReadFromJsonAsync<CreateTournamentResponse>(cancellationToken) ?? throw new InvalidOperationException("Server returned no tournament.");
    }
    public async Task<ControllerState> GetStateAsync(string tournamentId, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Get, "api/controller/tournaments/" + tournamentId + "/state"); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> AddContestantAsync(string tournamentId, int revision, string name, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Post, "api/controller/tournaments/" + tournamentId + "/contestants"); request.Content = JsonContent.Create(new { expectedRevision = revision, displayName = name }); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> BulkAddAsync(string tournamentId, int revision, string text, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Post, "api/controller/tournaments/" + tournamentId + "/contestants"); request.Content = JsonContent.Create(new { expectedRevision = revision, bulkText = text }); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> RenameContestantAsync(string tournamentId, string contestantId, int revision, string name, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Patch, "api/controller/tournaments/" + tournamentId + "/contestants/" + contestantId); request.Content = JsonContent.Create(new { expectedRevision = revision, displayName = name }); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> RemoveContestantAsync(string tournamentId, string contestantId, int revision, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Delete, "api/controller/tournaments/" + tournamentId + "/contestants/" + contestantId); request.Content = JsonContent.Create(new { expectedRevision = revision }); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> ReorderAsync(string tournamentId, int revision, IEnumerable<string> ids, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Put, "api/controller/tournaments/" + tournamentId + "/seeds"); request.Content = JsonContent.Create(new { expectedRevision = revision, contestantIds = ids }); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> RandomizeAsync(string tournamentId, int revision, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Post, "api/controller/tournaments/" + tournamentId + "/seeds/randomize"); request.Content = JsonContent.Create(new { expectedRevision = revision }); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> StartAsync(string tournamentId, int revision, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Post, "api/controller/tournaments/" + tournamentId + "/start"); request.Content = JsonContent.Create(new { expectedRevision = revision }); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> RecordWinnerAsync(string tournamentId, string matchId, int revision, string winnerId, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Post, "api/controller/tournaments/" + tournamentId + "/matches/" + matchId + "/result"); request.Content = JsonContent.Create(new { expectedRevision = revision, winnerId }); return await SendStateAsync(request, cancellationToken); }
    public async Task<ControllerState> CorrectAsync(string tournamentId, string matchId, int revision, string winnerId, bool rollback, CancellationToken cancellationToken) { using var request = Authorized(HttpMethod.Post, "api/controller/tournaments/" + tournamentId + "/matches/" + matchId + "/correction"); request.Content = JsonContent.Create(new { expectedRevision = revision, winnerId, rollbackDownstream = rollback }); return await SendStateAsync(request, cancellationToken); }
    private async Task<ControllerState> SendStateAsync(HttpRequestMessage request, CancellationToken cancellationToken) { using var response = await httpClient.SendAsync(request, cancellationToken); if (response.StatusCode == HttpStatusCode.Conflict) throw new InvalidOperationException("Tournament changed on another controller; refreshing state."); await ThrowIfExpiredAsync(response); return await response.Content.ReadFromJsonAsync<ControllerState>(cancellationToken) ?? throw new InvalidOperationException("Server returned no state."); }
    private HttpRequestMessage Authorized(HttpMethod method, string url) { var request = new HttpRequestMessage(method, Endpoint(url)); request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken); return request; }
    private Uri Endpoint(string path) => serverUri is null ? throw new InvalidOperationException("Configure the server before making a request.") : new Uri(serverUri, path.TrimStart('/'));
    private async Task ThrowIfExpiredAsync(HttpResponseMessage response) { if (response.StatusCode == HttpStatusCode.Unauthorized) { ClearSession(); throw new UnauthorizedAccessException("Session expired. Authenticate again."); } response.EnsureSuccessStatusCode(); await Task.CompletedTask; }
    private void EnsureSession() { if (!HasValidSession) throw new UnauthorizedAccessException("Authenticate before loading tournaments."); }
    public void Dispose() => httpClient.Dispose();
}
