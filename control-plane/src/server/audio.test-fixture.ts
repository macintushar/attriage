const OGG_HEADER_BYTES = 27

function page(granule: bigint, payload: Buffer, sequence: number) {
  const header = Buffer.alloc(OGG_HEADER_BYTES + 1)
  header.write("OggS", 0, "latin1")
  header[4] = 0
  header.writeBigUInt64LE(granule, 6)
  header.writeUInt32LE(sequence, 18)
  header[26] = 1
  header[27] = payload.length
  return Buffer.concat([header, payload])
}

export function oggOpusFixture({ seconds }: { seconds: number }) {
  const preSkip = 312
  const opusHead = Buffer.alloc(19)
  opusHead.write("OpusHead", 0, "latin1")
  opusHead.writeUInt16LE(preSkip, 10)
  return Buffer.concat([
    page(0n, opusHead, 0),
    page(BigInt(seconds * 48_000 + preSkip), Buffer.from("audio"), 1),
  ])
}
