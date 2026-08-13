import { useCallback, useRef, useState } from "react";

const AKZEPTIERT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.tif,.bmp,.gif";

export default function Dropzone({ onDateien, sperren }) {
  const [ueberDropzone, setUeberDropzone] = useState(false);
  const inputRef = useRef(null);

  const dateienWeitergeben = useCallback(
    (fileList) => {
      const dateien = Array.from(fileList || []);
      if (dateien.length) onDateien(dateien);
    },
    [onDateien]
  );

  return (
    <div
      className={`dropzone${ueberDropzone ? " dropzone--aktiv" : ""}${sperren ? " dropzone--gesperrt" : ""}`}
      role="button"
      tabIndex={sperren ? -1 : 0}
      onDragOver={(e) => {
        e.preventDefault();
        if (!sperren) setUeberDropzone(true);
      }}
      onDragLeave={() => setUeberDropzone(false)}
      onDrop={(e) => {
        e.preventDefault();
        setUeberDropzone(false);
        if (!sperren) dateienWeitergeben(e.dataTransfer.files);
      }}
      onClick={() => !sperren && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!sperren && (e.key === "Enter" || e.key === " ")) inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={AKZEPTIERT}
        hidden
        disabled={sperren}
        onChange={(e) => {
          dateienWeitergeben(e.target.files);
          e.target.value = "";
        }}
      />
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ marginBottom: 10, opacity: 0.7 }}>
        <path d="M3 6.5 12 13l9-6.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="3" y="4.5" width="18" height="14" rx="1.2" strokeLinejoin="round" />
      </svg>
      <p className="dropzone__titel">{sperren ? "Wird verarbeitet …" : "Schreiben hier ablegen oder klicken"}</p>
      <p className="dropzone__hinweis">Scans, Fotos oder PDFs — auch mehrere gleichzeitig, wie ein Posteingangsstapel</p>
    </div>
  );
}
