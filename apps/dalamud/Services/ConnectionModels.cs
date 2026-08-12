namespace TournamentControl.Dalamud.Services;

public sealed record SessionResponse(string AccessToken, DateTimeOffset ExpiresAt);
public enum ConnectionState { Disconnected, Connecting, Connected, Expired, Failed }
public sealed record ControllerTournament(string Id, string PublicCode, string VenueName, string GameName, string TournamentName, DateTimeOffset EventDate, string Status, int Revision, int PlayerCount);
public sealed record TournamentListResponse(IReadOnlyList<ControllerTournament> Tournaments);
public sealed record CreateTournamentRequest(string VenueName, string GameName, string TournamentName, DateTimeOffset EventDate);
public sealed record CreateTournamentResponse(ControllerTournament Tournament, string PublicUrl);
public sealed record ControllerContestant(string Id, string DisplayName, int Seed, string Status);
public sealed record ControllerRound(string Id, int RoundNumber, string Name);
public sealed record ControllerState(ControllerTournament Tournament, List<ControllerContestant> Contestants, List<ControllerRound> Rounds, List<ControllerMatch> Matches);
public sealed record ControllerMatch(string Id, string RoundId, int Position, string? Player1Id, string? Player2Id, string? WinnerId, string? LoserId, string Status, string? NextWinnerMatchId);
