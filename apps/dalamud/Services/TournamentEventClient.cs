using System.Net.WebSockets;

namespace TournamentControl.Dalamud.Services;

// Uses ClientWebSocket rather than Socket.IO; subscription protocol is defined in docs/api.md.
public sealed class TournamentEventClient : IDisposable
{
    private ClientWebSocket? socket;
    private CancellationTokenSource? lifetime;
    public ConnectionState State { get; private set; } = ConnectionState.Disconnected;

    public async Task ConnectAsync(Uri serverUri, string accessToken, CancellationToken cancellationToken)
    {
        Disconnect(); lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        for (var attempt = 0; attempt < 5 && !lifetime.IsCancellationRequested; attempt++)
        {
            try { State = ConnectionState.Connecting; socket = new ClientWebSocket(); var wsUri = new UriBuilder(serverUri) { Scheme = serverUri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws", Path = "ws" }.Uri; await socket.ConnectAsync(wsUri, lifetime.Token); State = ConnectionState.Connected; await SendAsync(new { version = 1, type = "authenticate", data = new { accessToken } }, lifetime.Token); _ = ReceiveLoopAsync(lifetime.Token); return; }
            catch (OperationCanceledException) { break; }
            catch { State = ConnectionState.Failed; await Task.Delay(TimeSpan.FromSeconds(Math.Min(10, attempt + 1)), lifetime.Token); }
        }
    }

    public async Task SendAsync<T>(T message, CancellationToken cancellationToken) { if (socket?.State != WebSocketState.Open) return; var bytes = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(message); await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken); }
    public void Disconnect() { lifetime?.Cancel(); lifetime?.Dispose(); lifetime = null; socket?.Dispose(); socket = null; State = ConnectionState.Disconnected; }
    private async Task ReceiveLoopAsync(CancellationToken cancellationToken) { var buffer = new byte[4096]; try { while (socket?.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested) { var result = await socket.ReceiveAsync(buffer, cancellationToken); if (result.MessageType == WebSocketMessageType.Close) break; } } catch (OperationCanceledException) { } finally { if (!cancellationToken.IsCancellationRequested) State = ConnectionState.Disconnected; } }
    public void Dispose() => Disconnect();
}
