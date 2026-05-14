module Preview = {
  @module("./SubtitleOctopusPreview") @react.component
  external make: (
    ~width: int,
    ~height: int,
    ~cues: array<Subtitles.subtitleCue>,
    ~subtitleStyle: {..},
    ~currentTime: float,
  ) => React.element = "SubtitleOctopusPreview"
}

let mergeStyleWithMeta: (Style.style, int, int) => {..} = %raw(`
  function(style, videoWidth, videoHeight) {
    return Object.assign({}, style, { _videoWidth: videoWidth, _videoHeight: videoHeight });
  }
`)

@react.component
let make = (~cues: array<Subtitles.subtitleCue>) => {
  let ctx = EditorContext.useEditorContext()
  let (player, _) = ctx.usePlayer()
  let (subtitleStyle, _) = ctx.useStyle()
  let videoWidth = ctx.videoMeta.width
  let videoHeight = ctx.videoMeta.height

  let styleWithMeta = mergeStyleWithMeta(subtitleStyle, videoWidth, videoHeight)

  <Preview.make
    width=videoWidth
    height=videoHeight
    cues
    subtitleStyle=styleWithMeta
    currentTime={player.ts}
  />
}
