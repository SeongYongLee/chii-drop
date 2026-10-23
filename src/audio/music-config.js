// Legacy single-track entries and explicit playlists share the same representation at playback boundaries.
function musicTracks(entry) {
  return Array.isArray(entry?.tracks) ? entry.tracks : entry?.file ? [entry] : [];
}
function allMusicTracks(music) {
  return [music, ...Object.values(music?.scenes ?? {})].flatMap(musicTracks);
}
function mapMusicFiles(music, map) {
  if (!music) return null;
  const entry = value => ({ ...value,
    ...(value.file ? { file: map(value.file) } : {}),
    ...(Array.isArray(value.tracks) ? { tracks: value.tracks.map(track => ({ ...track, file: map(track.file) })) } : {}),
  });
  return { ...entry(music), scenes: Object.fromEntries(Object.entries(music.scenes ?? {}).map(([key,value]) => [key,entry(value)])) };
}
export { musicTracks, allMusicTracks, mapMusicFiles };
