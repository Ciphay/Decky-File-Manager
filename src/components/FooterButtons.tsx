type Props = {
  showOptions: boolean;
  onBack: () => void;
  onOptions: () => void;
  onSplit: () => void;
  onSelect: () => void;
};

const area = (visible = true) => ({
  width: 80,
  height: 60,
  display: visible ? "flex" : "none",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  pointerEvents: visible ? "auto" : "none",
} as const);

export default function FooterButtons({ showOptions, onBack, onOptions, onSplit, onSelect }: Props) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 24,
        paddingRight: 24,
        pointerEvents: "none",
        zIndex: 999,
        background: "transparent",
      }}
    >
      <div style={area()} onClick={onBack} />
      <div style={area(showOptions)} onClick={onOptions} />
      <div style={area()} onClick={onSplit} />
      <div style={area()} onClick={onSelect} />
    </div>
  );
}
