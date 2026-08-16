import manifest from '../../shared/product-config.json';

export type ProductFeature = keyof typeof manifest.features;

/** Shared product identity and default feature availability. */
export const PRODUCT_CONFIG = Object.freeze({
  ...manifest,
  features: Object.freeze({ ...manifest.features }),
});

export const PRODUCT_FEATURES = PRODUCT_CONFIG.features;
export const isProductFeatureEnabled = (feature: ProductFeature): boolean => PRODUCT_FEATURES[feature] === true;

/** Hosted platform behavior requires both the central feature and its explicit runtime mode. */
export const IS_PLATFORM = PRODUCT_FEATURES.hosted && import.meta.env?.VITE_IS_PLATFORM === 'true';

/**
 * For empty shell instances where no project is provided,
 * we use a default project object to ensure the shell can still function.
 * This prevents errors related to missing project data.
 *
 * `projectId` is set to a well-known sentinel ('default') because the empty
 * shell doesn't correspond to any real project row in the database; any API
 * call that routes through this placeholder must tolerate a missing match.
 */
export const DEFAULT_PROJECT_FOR_EMPTY_SHELL = {
  projectId: 'default',
  displayName: 'default',
  fullPath: IS_PLATFORM ? '/workspace' : '',
  path: IS_PLATFORM ? '/workspace' : '',
};
