/**
 * Global Display Coordinator for Valleyball In-Arena Stadium Displays.
 *
 * Implements a strict per-frame GPU texture upload budget to eliminate
 * synchronization stalls across the PCIe bus during 1-second clock ticks
 * and live telemetry refreshes.
 */
export const displayCoordinator = {
  budget: 1,
  totalUploads: 0,
  maxUploadsInSingleFrame: 0,
  _currentFrameUploads: 0,

  reset(maxUploadsPerFrame = 1) {
    if (this._currentFrameUploads > this.maxUploadsInSingleFrame) {
      this.maxUploadsInSingleFrame = this._currentFrameUploads;
    }
    this._currentFrameUploads = 0;
    this.budget = maxUploadsPerFrame;
  },

  canUpload() {
    return this.budget > 0;
  },

  consumeUpload() {
    if (this.budget > 0) {
      this.budget--;
      this.totalUploads++;
      this._currentFrameUploads++;
      return true;
    }
    return false;
  },

  getStats() {
    return {
      budgetRemaining: this.budget,
      totalUploads: this.totalUploads,
      maxUploadsInSingleFrame: Math.max(this.maxUploadsInSingleFrame, this._currentFrameUploads),
    };
  },
};
