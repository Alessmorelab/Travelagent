class ChatError(Exception):
    """A user-facing chat failure with a stable HTTP/WebSocket error code."""

    def __init__(self, message: str, code: int = 400):
        super().__init__(message)
        self.code = code
