import manifest from './product-config.json' with { type: 'json' };

/**
 * Shared immutable product configuration consumed by the web app, server,
 * Electron shell, and release tooling. The JSON manifest is the only source
 * that may define product links or default feature availability.
 */
export const productConfig = Object.freeze({
  ...manifest,
  features: Object.freeze({ ...manifest.features }),
});

/** Return whether a centrally declared product feature is available. */
export function isProductFeatureEnabled(feature) {
  return productConfig.features[feature] === true;
}
