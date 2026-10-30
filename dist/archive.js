// Uncompressed ZIP with UTF-8 filenames; no external runtime dependencies.
export function zipTxtFiles(files) {
  if (files.length > 65535) throw new Error('Слишком много файлов для одного архива.');
  const encoder = new TextEncoder(), local = [], central = [];
  let offset = 0, centralSize = 0;
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const file of files) {
    const name = encoder.encode('exports/' + file.filename), data = encoder.encode(file.text), crc = crc32(data);
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(12, 0x0021, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    const directory = new Uint8Array(46), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true);
    d.setUint16(14, 0x0021, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    local.push(header, name, data); central.push(directory, name);
    offset += header.length + name.length + data.length; centralSize += directory.length + name.length;
    if (offset + centralSize > 0xffffffff) throw new Error('Архив слишком большой.');
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], {type:'application/zip'});
}
