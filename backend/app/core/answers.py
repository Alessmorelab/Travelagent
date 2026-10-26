"""Filter explicitly marked reasoning before either streaming or saving an answer."""

import re


class PublicAnswerText:
    _marker = re.compile(r'<(/?)(think|thinking|analysis)>', re.IGNORECASE)
    _tags = tuple(f'<{slash}{name}>' for name in ('think', 'thinking', 'analysis') for slash in ('', '/'))

    def __init__(self):
        self.pending = ''
        self.hidden = []

    def feed(self, text: str) -> str:
        self.pending += text
        output = []
        while self.pending:
            marker = self._marker.search(self.pending)
            if marker:
                if not self.hidden:
                    output.append(self.pending[:marker.start()])
                name = marker.group(2).lower()
                if not marker.group(1):
                    self.hidden.append(name)
                elif self.hidden and self.hidden[-1] == name:
                    self.hidden.pop()
                self.pending = self.pending[marker.end():]
            else:
                # A marker may cross chunk boundaries. Retain only its possible
                # prefix, never an unbounded buffer containing private reasoning.
                lower = self.pending.lower()
                keep = max((length for tag in self._tags for length in range(1, len(tag))
                            if lower.endswith(tag[:length])), default=0)
                if not self.hidden:
                    output.append(self.pending[:-keep] if keep else self.pending)
                self.pending = self.pending[-keep:] if keep else ''
                break
        return ''.join(output)


def public_answer(text: str) -> str:
    return PublicAnswerText().feed(text)
