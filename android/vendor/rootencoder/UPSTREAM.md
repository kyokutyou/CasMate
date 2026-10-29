# RootEncoder local source integration

- Upstream: https://github.com/pedroSG94/RootEncoder
- Version: 2.8.1; commit `cca548ab7942ab50d34dede272d5da90d46c6b67`.
- Source archive: https://codeload.github.com/pedroSG94/RootEncoder/zip/cca548ab7942ab50d34dede272d5da90d46c6b67
- Archive SHA-256: `1738dc15e8ecfa7506e51789506921da2183bb22666ab8dcefc082844215a664`.
- License: Apache-2.0, preserved in LICENSE.txt and the application license assets.

Only the main sources/resources of common, srt, encoder, and library are vendored.
The other upstream transport modules retain their pinned binary dependencies.
Local Gradle integration replaces transitive copies of all four local modules.
Publication, sample applications, and upstream documentation generators are not included.
`upstream-sha256.json` records the original files for reviewing future changes.

CasMate additions provide bounded sender observations, bitrate application results,
and frame identity across GL rendering, encoding, sending, and acknowledgement.
Existing entry points remain available for upstream binary callers. These additions
do not replace the SRT handshake, encryption, packetization, or retransmission protocol.

Native transport build and validation commands are documented in
[the native transport README](../../../native/outdoor/README.md).

Since the native transport adoption (ADR 0018), CasMate uses only the MPEG-TS packetizer from the srt module. The Kotlin SRT client is not started by the product; connection, encryption and retransmission are owned by native libsrt.

The MPEG-TS packetizer derives PCR from each PES presentation timestamp instead of
device uptime, so the PTS-only stream retains one clock domain across reconnects
and 33-bit timestamp wraparound. PES exposes its existing timestamp read-only;
constructor signatures and presentation timestamps are unchanged.

Preview EGL attachment and removal in GlStreamInterface run on its rendering
executor and ignore callbacks from stopped renderer generations. SurfaceManager
shared contexts borrow the initialized display; only its owning context releases
the EGL display and thread. Both GL front ends delete their GL render resources
before releasing child contexts and finally the owning display. These changes
preserve encoder, audio and SRT lifetimes across preview recreation.
