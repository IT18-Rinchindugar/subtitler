let formatFontWeight = weight =>
  switch weight {
  | Style.Thin => "Thin"
  | Style.ExtraLight => "Extra Light"
  | Style.Light => "Light"
  | Style.Regular => "Regular"
  | Style.Medium => "Medium"
  | Style.SemiBold => "Semi Bold"
  | Style.Bold => "Bold"
  | Style.ExtraBold => "Extra Bold"
  | Style.Black => "Black"
  }

let adornmentClassName = "font-mono rounded-md m-1 bg-zinc-500 px-3 inset-y-0"

@react.component
let make = Utils.neverRerender(() => {
  let id = React.useId()
  let editorContext = EditorContext.useEditorContext()
  let (style, dispatch) = editorContext.useStyle()

  <div className="overflow-auto pb-6 pr-2 2xl:pr-4">
    <div className="flex flex-col gap-6">
      <div
        className="rounded-xl focus-within:border-zinc-500 border transition-colors border-transparent grid grid-cols-2 gap-2 bg-white/5 p-3 w-full">
        <NumberInput
          labelHidden=true
          label="X coordinate"
          adornmentClassName
          className="w-full"
          min=0
          max=999
          adornment={"X"->React.string}
          value={style.x}
          onChange={val => dispatch(Style.SetPosition(val, style.y))}
        />
        <NumberInput
          labelHidden=true
          min=0
          max=999
          label="Y coordinate"
          className="w-full"
          adornment={"Y"->React.string}
          adornmentClassName
          value={style.y}
          onChange={val => dispatch(Style.SetPosition(style.x, val))}
        />
        <NumberInput
          min=0
          max=999
          labelHidden=true
          label="Width"
          className="w-full"
          adornment={"W"->React.string}
          adornmentClassName
          value={style.blockSize.width}
          onChange={val => dispatch(Style.SetBlockWidth(val))}
        />
        <NumberInput
          min=0
          max=999
          labelHidden=true
          label="Height"
          className="w-full"
          adornment={"H"->React.string}
          adornmentClassName
          value={style.blockSize.height}
          onChange={val => dispatch(Style.SetBlockHeight(val))}
        />
      </div>
      <div
        className="rounded-xl focus-within:border-zinc-500 border transition-colors border-transparent grid grid-cols-3 md:grid-cols-6 gap-2 bg-white/5 p-3 w-full">
        <Input.Field className="col-span-3">
          <Input.Label forId={"font-picker" ++ id} className="whitespace-nowrap">
            {React.string("Font")}
          </Input.Label>
          <ReactFontPicker
            inputId={"font-picker" ++ id}
            initialFont={style.fontFamily}
            onFontVariantInfo={Hooks.useEvent(variants => {
              dispatch(Array.length(variants) > 0 ? SetFontVariants(variants) : ResetFontVariants)
            })}
            onFontLoad={Hooks.useEvent(val => {
              dispatch(SetFontFamily(val))
            })}
          />
        </Input.Field>
        <div className="flex gap-2 col-span-3">
          <Input
            type_="color"
            label="Fill"
            className="w-full col-span-1 flex-1"
            value={style.color}
            onChange={value => dispatch(Style.SetColor(value))}
          />
          <Input
            type_="color"
            label="Stroke"
            className="w-full col-span-1 flex-1"
            value={style.strokeColor->Option.getOr(style.color)}
            onChange={value => dispatch(Style.SetStrokeColor(value))}
          />
          <NumberInput
            label="width"
            adornmentClassName
            min=0
            max=999
            value={style.strokeWidth}
            onChange={strokeWidth => dispatch(Style.SetStrokeWidth(strokeWidth))}
          />
        </div>
        <Input.Field className="col-span-3">
          <Input.Label className="whitespace-nowrap"> {React.string("Font weight")} </Input.Label>
          <Combobox
            selected={style.fontWeight}
            setSelected={value => value->Option.forEach(value => dispatch(SetFontWeight(value)))}
            options={style.fontVariants}
            formatValue={formatFontWeight}
            filter={value => item =>
              item
              ->formatFontWeight
              ->String.toLowerCase
              ->String.includes(value)}
          />
        </Input.Field>
        <NumberInput
          label="Size"
          min=0
          max=999
          value={style.fontSizePx}
          className="min-w-[4ch]"
          onChange={val => dispatch(Style.SetFontSizePx(val))}
        />
        <Input.Field className="col-span-2">
          <Input.Label forId={""} className="whitespace-nowrap">
            {React.string("Text align")}
          </Input.Label>
          <ToggleButton.Group
            value={style.align} onChange={value => dispatch(Style.SetAlign(value))}>
            <ToggleButton.Button value={Style.Left}>
              <Icons.BarsCenterLeftIcon className="size-4" />
            </ToggleButton.Button>
            <ToggleButton.Button value={Style.Center}>
              <Icons.BarsIcon className="size-4" />
            </ToggleButton.Button>
            <ToggleButton.Button value={Style.Right}>
              <Icons.BarsCenterRightIcon className="size-4" />
            </ToggleButton.Button>
          </ToggleButton.Group>
        </Input.Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-4">
          <ToggleSwitch
            labelId="background-title"
            enabled={style.showBackground}
            onChange={_ => dispatch(Style.ToggleBackground)}
          />
          <h3 id="background-title"> {React.string("Background")} </h3>
        </div>
        <div
          className={Cx.cx([
            "rounded-xl focus-within:border-zinc-500 border transition-colors border-transparent grid grid-cols-4 gap-2 bg-white/5 p-3 w-full",
            style.showBackground ? "brightness-100" : "brightness-50 pointer-events-none",
          ])}>
          <Input
            type_="color"
            label="Fill"
            className="w-full col-span-1 flex-1"
            value={style.background.color}
            onChange={value => dispatch(Style.SetBackground({...style.background, color: value}))}
          />
          <NumberInput.Float
            label="Opacity"
            className="w-full col-span-1 flex-1"
            min=0.0
            max=1.0
            step=0.1
            value={style.background.opacity}
            onChange={opacity => dispatch(Style.SetBackground({...style.background, opacity}))}
          />
          <Input
            type_="color"
            label="Stroke"
            className="w-full col-span-1 flex-1"
            value={style.background.color}
            onChange={value =>
              dispatch(Style.SetBackground({...style.background, strokeColor: Some(value)}))}
          />
          <NumberInput
            label="width"
            adornmentClassName
            className="w-full"
            min=0
            max=999
            value={style.background.strokeWidth}
            onChange={strokeWidth =>
              dispatch(Style.SetBackground({...style.background, strokeWidth}))}
          />
          <NumberInput
            label="Border radius"
            className="w-full col-span-2"
            min=0
            max=999
            adornmentClassName="font-mono rounded-md bg-zinc-500 px-2.5 inset-y-0"
            adornment={<Icons.BorderRadiusIcon color="white" className="size-4" />}
            value={style.background.borderRadius}
            onChange={borderRadius =>
              dispatch(Style.SetBackground({...style.background, borderRadius}))}
          />
          <NumberInput
            label="Padding X"
            adornmentClassName
            className="w-full"
            min=0
            max=999
            value={style.background.paddingX}
            onChange={paddingX => dispatch(Style.SetBackground({...style.background, paddingX}))}
          />
          <NumberInput
            label="Padding Y"
            adornmentClassName
            className="w-full"
            min=0
            max=999
            value={style.background.paddingY}
            onChange={paddingY => dispatch(Style.SetBackground({...style.background, paddingY}))}
          />
        </div>
      </div>
    </div>
  </div>
})
