open Types
open ChunksList

@genType
let a = Js.Dict.empty

Js.Console.log("Happy subtitles making experience!")

let useIsMobile = () => {
  let (isMobile, setIsMobile) = React.useState(() =>
    Webapi.Dom.window->Webapi.Dom.Window.innerWidth < 768
  )

  React.useEffect0(() => {
    let handleResize = _ => {
      setIsMobile(_ => Webapi.Dom.window->Webapi.Dom.Window.innerWidth < 768)
    }
    Webapi.Dom.window->Webapi.Dom.Window.addEventListener("resize", handleResize)
    Some(() => Webapi.Dom.window->Webapi.Dom.Window.removeEventListener("resize", handleResize))
  })

  isMobile
}

let calcMobilePreviewScale = (videoWidth, videoHeight) => {
  let vw = Webapi.Dom.window->Webapi.Dom.Window.innerWidth->Int.toFloat -. 24.0
  let vh = Webapi.Dom.window->Webapi.Dom.Window.innerHeight->Int.toFloat *. 0.45
  Js.Math.min_float(vw /. videoWidth, vh /. videoHeight)
}

module MobileSeekSlider = {
  @react.component
  let make = (~duration: float) => {
    let ctx = EditorContext.useEditorContext()
    let (player, playerDispatch) = ctx.usePlayer()
    let handleSeek = Hooks.useEvent(value => playerDispatch(Player.Seek(value->Int.toFloat)))

    <div className="w-full px-4 py-2">
      <Slider
        disabled=false
        min=0
        max={duration->Float.toInt}
        step=1
        value={player.ts->Float.toInt}
        onValueChange=handleSeek
      />
      <div className="flex justify-between text-xs text-zinc-400 mt-1">
        <span> {player.ts->Utils.Duration.formatSeconds->React.string} </span>
        <span> {duration->Utils.Duration.formatSeconds->React.string} </span>
      </div>
    </div>
  }
}

module MobileCanvasStyle = {
  let make = (~width, ~height, ~scale) =>
    ReactDOMStyle.make(
      ~width=`${width->Int.toString}px`,
      ~height=`${height->Int.toString}px`,
      ~transform=`scale(${scale->Js.Float.toString})`,
      ~transformOrigin="top left",
      (),
    )
}

module SaveStatusBadge = {
  @react.component
  let make = (~saveStatus: string) => {
    let (label, className) = switch saveStatus {
    | "saving" => (
        "Saving…",
        "text-zinc-400",
      )
    | "saved" => (
        "Saved",
        "text-green-400",
      )
    | "error" => (
        "Save failed",
        "text-red-400",
      )
    | _ => ("", "")
    }

    if String.length(label) == 0 {
      React.null
    } else {
      <span className={`text-xs font-medium ${className}`}> {label->React.string} </span>
    }
  }
}

@genType.as("Editor") @react.component
let make = React.memo((
  ~subtitlesManager,
  ~render,
  ~rendererPreviewCanvasRef,
  ~renderCanvasKey,
  ~videoFileName,
  ~onResetPlayerState,
  ~saveStatus: string,
  ~onBack: unit => unit,
  ~projectTitle: string,
) => {
  let (isFullScreen, fullScreenToggler) = Hooks.useToggle(false)
  let ctx = EditorContext.useEditorContext()
  let _layout = Hooks.useEditorLayout(~isFullScreen)
  let isMobile = useIsMobile()
  let viewportSize = Hooks.useDimensions()

  let videoWidth = ctx.videoMeta.width->Int.toFloat
  let videoHeight = ctx.videoMeta.height->Int.toFloat

  React.useEffect0(() => {
    onResetPlayerState(() => ctx.playerImmediateDispatch(AbortRender))
    None
  })

  let transcriptionInProgress = subtitlesManager.transcriptionState == TranscriptionInProgress

  let subtitlesTitle = if transcriptionInProgress {
    <div className="gap-2 inline-flex items-center">
      <Spinner />
      <span> {"Transcribing"->React.string} </span>
    </div>
  } else {
    "Subtitles"->React.string
  }

  let lastIsTranscriptionInProgress = React.useRef(transcriptionInProgress)
  React.useLayoutEffect1(() => {
    if !transcriptionInProgress && lastIsTranscriptionInProgress.current {
      lastIsTranscriptionInProgress.current = true
      ctx.playerImmediateDispatch(UpdateCurrentCue)
    }
    None
  }, [subtitlesManager.transcriptionState])

  let styleTitle = React.string("Style")
  let previewTitle = React.string("Preview")

  let (mobileScale, setMobileScale) = React.useState(() =>
    calcMobilePreviewScale(videoWidth, videoHeight)
  )

  React.useEffect0(() => {
    let onResize = _ => setMobileScale(_ => calcMobilePreviewScale(videoWidth, videoHeight))
    Webapi.Dom.window->Webapi.Dom.Window.addEventListener("resize", onResize)
    Some(() => Webapi.Dom.window->Webapi.Dom.Window.removeEventListener("resize", onResize))
  })

  let mobileCanvasStyle = MobileCanvasStyle.make(
    ~width=ctx.videoMeta.width,
    ~height=ctx.videoMeta.height,
    ~scale=mobileScale,
  )

  let mobilePreviewContent =
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 flex items-center justify-center min-h-0">
        <div
          className="relative shrink-0"
          style={ReactDOMStyle.make(
            ~width=`${(videoWidth *. mobileScale)->Js.Float.toString}px`,
            ~height=`${(videoHeight *. mobileScale)->Js.Float.toString}px`,
            (),
          )}>
          <canvas
            id="editor-preview"
            ref={ReactDOM.Ref.domRef(ctx.dom.canvasRef)}
            width={ctx.videoMeta.width->Int.toString}
            height={ctx.videoMeta.height->Int.toString}
            style=mobileCanvasStyle
            className="bg-black absolute inset-0"
          />
          <canvas
            key={renderCanvasKey->Int.toString}
            ref={ReactDOM.Ref.domRef(rendererPreviewCanvasRef)}
            width={ctx.videoMeta.width->Int.toString}
            height={ctx.videoMeta.height->Int.toString}
            style=mobileCanvasStyle
            className="absolute inset-0"
          />
          <EditorCanvas
            transcriptionInProgress
            subtitles=subtitlesManager.activeSubtitles
            subtitlesManager
            width=ctx.videoMeta.width
            height=ctx.videoMeta.height
            style=mobileCanvasStyle
            className="absolute inset-0"
          />
        </div>
      </div>
      <div className="shrink-0 bg-zinc-900/80 backdrop-blur-sm rounded-lg mx-3 mb-2 p-1">
        <MobileSeekSlider duration={ctx.videoMeta.duration} />
      </div>
    </div>

  let header =
    <header
      className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm">
      <button
        onClick={_ => onBack()}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white">
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {"Back"->React.string}
      </button>
      <span className="h-4 w-px bg-zinc-700" />
      <p className="flex-1 truncate text-sm font-medium text-white"> {projectTitle->React.string} </p>
      <SaveStatusBadge saveStatus />
    </header>

  if isMobile {
    <div
      id="fframes-editor"
      className="w-screen h-dvh bg-zinc-950 flex flex-col fixed inset-0 overflow-hidden">
      {header}
      <div className="flex-1 flex flex-col min-h-0">
        <Tabs
          defaultIndex=0
          className="outline-none"
          tabs=[
            {
              id: "subtitles",
              name: subtitlesTitle,
              content: <div className="px-3 py-2">
                <ChunksList subtitlesManager title={React.null} />
              </div>,
            },
            {
              id: "style",
              name: styleTitle,
              content: <div className="px-3 py-2">
                <StyleEditor />
              </div>,
            },
            {
              id: "preview",
              name: previewTitle,
              content: mobilePreviewContent,
            },
          ]
        />
      </div>
      <div
        className="shrink-0 border-t border-zinc-800 bg-zinc-900/95 backdrop-blur-sm flex justify-center py-1">
        <Dock render fullScreenToggler subtitlesManager videoFileName />
      </div>
    </div>
  } else {
    // Desktop: fixed left panel (subtitles on top, style below) + video fills the rest
    let leftPanelWidth = 460
    let rightPanelViewport: UseDimensions.dimensions = {
      width: viewportSize.width - leftPanelWidth,
      height: viewportSize.height,
    }
    let desktopPreview = UseEditorLayout.calculatePreviewSize(
      rightPanelViewport,
      ctx.videoMeta,
      ~min_media_controls_width=0,
      ~min_timeline_height=UseEditorLayout.min_timeline_height,
    )

    <div
      id="fframes-editor"
      className="w-screen h-screen bg-zinc-950 overflow-hidden flex flex-col">
      {header}
      // ── Body: left panel + right video panel ──────────────────────────────
      <div className="flex flex-1 min-h-0 overflow-hidden">
        // ── Left panel: tabbed subtitles / style ─────────────────────────
        <div
          className="w-[460px] shrink-0 flex flex-col border-r border-zinc-800 overflow-hidden bg-zinc-950">
          <Tabs
            defaultIndex=0
            className="outline-none"
            tabs=[
              {
                id: "subtitles",
                name: subtitlesTitle,
                content: <div className="px-4 py-3 h-full">
                  <ChunksList subtitlesManager title={React.null} />
                </div>,
              },
              {
                id: "style",
                name: styleTitle,
                content: <div className="px-4 py-3">
                  <StyleEditor />
                </div>,
              },
            ]
          />
        </div>

        // ── Right panel: video centered + letterboxed ─────────────────────
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-zinc-950">
          <div className="flex-1 flex items-center justify-center min-h-0 p-4">
            <div
              className="relative shrink-0 bg-black"
              style={ReactDOMStyle.make(
                ~width=`${(ctx.videoMeta.width->Int.toFloat *. desktopPreview.scale)->Js.Float.toString}px`,
                ~height=`${(ctx.videoMeta.height->Int.toFloat *. desktopPreview.scale)->Js.Float.toString}px`,
                (),
              )}>
              <canvas
                id="editor-preview"
                ref={ReactDOM.Ref.domRef(ctx.dom.canvasRef)}
                width={ctx.videoMeta.width->Int.toString}
                height={ctx.videoMeta.height->Int.toString}
                style={ReactDOMStyle.make(
                  ~width=`${ctx.videoMeta.width->Int.toString}px`,
                  ~height=`${ctx.videoMeta.height->Int.toString}px`,
                  ~transform=`scale(${desktopPreview.scale->Js.Float.toString})`,
                  ~transformOrigin="top left",
                  (),
                )}
                className="bg-black absolute inset-0"
              />
              <canvas
                key={renderCanvasKey->Int.toString}
                ref={ReactDOM.Ref.domRef(rendererPreviewCanvasRef)}
                width={ctx.videoMeta.width->Int.toString}
                height={ctx.videoMeta.height->Int.toString}
                style={ReactDOMStyle.make(
                  ~width=`${ctx.videoMeta.width->Int.toString}px`,
                  ~height=`${ctx.videoMeta.height->Int.toString}px`,
                  ~transform=`scale(${desktopPreview.scale->Js.Float.toString})`,
                  ~transformOrigin="top left",
                  (),
                )}
                className="absolute inset-0"
              />
              <EditorCanvas
                transcriptionInProgress
                subtitles=subtitlesManager.activeSubtitles
                subtitlesManager
                width=ctx.videoMeta.width
                height=ctx.videoMeta.height
                style={ReactDOMStyle.make(
                  ~width=`${ctx.videoMeta.width->Int.toString}px`,
                  ~height=`${ctx.videoMeta.height->Int.toString}px`,
                  ~transform=`scale(${desktopPreview.scale->Js.Float.toString})`,
                  ~transformOrigin="top left",
                  (),
                )}
                className="bg-transparent absolute inset-0"
              />
            </div>
          </div>
          // Timeline below video
          <div className="shrink-0">
            {UseEditorLayout.calculateTimelineSize(
              rightPanelViewport,
              desktopPreview,
            )
            ->Belt.Option.map(sectionSize =>
              <div
                style={sectionSize->UseEditorLayout.sizeToStyle}
                className="shadow-lg w-full bg-zinc-800">
                <Timeline sectionSize />
              </div>
            )
            ->Option.getOr(React.null)}
          </div>
        </div>
      </div>
      <Dock render fullScreenToggler subtitlesManager videoFileName />
    </div>
  }
})
