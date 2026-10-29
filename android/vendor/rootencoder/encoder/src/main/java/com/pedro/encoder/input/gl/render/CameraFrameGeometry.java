package com.pedro.encoder.input.gl.render;

/** Immutable camera transform, shared by rendering and inverse focus mapping. */
public final class CameraFrameGeometry {
  public final int rotation;
  private final int sourceWidth;
  private final int sourceHeight;

  public CameraFrameGeometry(int rotation, int sourceWidth, int sourceHeight) {
    if (rotation % 90 != 0 || sourceWidth <= 0 || sourceHeight <= 0) {
      throw new IllegalArgumentException("Invalid camera geometry");
    }
    this.rotation = ((rotation % 360) + 360) % 360;
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;
  }

  /** Producer transform includes sensor rotation, mirroring and crop. Null means unavailable. */
  public float[] fit(int width, int height, float[] texture) {
    if (width <= 0 || height <= 0 || texture == null || texture.length != 16) return null;
    double horizontal = Math.hypot(texture[0] * sourceWidth, texture[1] * sourceHeight);
    double vertical = Math.hypot(texture[4] * sourceWidth, texture[5] * sourceHeight);
    if (!Double.isFinite(horizontal) || !Double.isFinite(vertical) || horizontal <= 0 || vertical <= 0) return null;
    double aspect = rotation % 180 == 0 ? horizontal / vertical : vertical / horizontal;
    double target = (double) width / height;
    return aspect <= target ? new float[]{(float) (aspect / target), 1f}
        : new float[]{1f, (float) (target / aspect)};
  }

  /** View-normalized, top-left point -> rotated quad; reject the fitted frame's padding. */
  public float[] unfit(float x, float y, int width, int height, float[] texture) {
    float[] scale = fit(width, height, texture);
    if (scale == null || !Float.isFinite(x) || !Float.isFinite(y)) return null;
    float u = (x - .5f) / scale[0] + .5f;
    float v = (y - .5f) / scale[1] + .5f;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? new float[]{u, v} : null;
  }
}
