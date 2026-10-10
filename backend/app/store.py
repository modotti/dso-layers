from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MediaAsset:
    content: bytes
    media_type: str = "image/png"


class MemoryProjectStore:
    def __init__(self) -> None:
        self._media: dict[tuple[str, str], MediaAsset] = {}
        self._sources: dict[tuple[str, str], bytes] = {}

    def put_media(self, project_id: str, name: str, asset: MediaAsset) -> None:
        self._media[(project_id, name)] = asset

    def put_source(self, project_id: str, name: str, source: bytes) -> None:
        self._sources[(project_id, name)] = source

    def get_media(self, project_id: str, name: str) -> MediaAsset | None:
        return self._media.get((project_id, name))

    def delete_project(self, project_id: str) -> None:
        self._media = {key: value for key, value in self._media.items() if key[0] != project_id}
        self._sources = {key: value for key, value in self._sources.items() if key[0] != project_id}
