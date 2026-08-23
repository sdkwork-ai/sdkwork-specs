export const SPEC_VERSION = 1;

export const INSTALL_LAYOUTS = new Set(['source-tree', 'binary-package']);

export const EXPOSE_MODES = new Set(['web', 'api', 'web+api']);

export const WEB_SURFACES = new Set(['pc', 'h5']);

export const PACKAGE_NAMES = new Set([
  'flutter-mobile',
  'harmony-mobile',
  'android-mobile',
  'ios-mobile',
  'mini-program-weixin',
  'mini-program-alipay',
  'desktop-windows',
  'desktop-macos',
  'desktop-linux',
]);

export const PACKAGE_ALIASES = {
  weixin: 'mini-program-weixin',
  alipay: 'mini-program-alipay',
  windows: 'desktop-windows',
  macos: 'desktop-macos',
  linux: 'desktop-linux',
};

export const FORBIDDEN_PACKAGE_NAMES = new Set(['pc', 'h5', 'ship']);

export const NGINX_SITE_FAMILY = 'sdkwork';

export const DEFAULT_MOBILE_UA_REGEX =
  '(Mobile|Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini|MicroMessenger|HuaweiBrowser|HarmonyOS|UCBrowser|Quark)';

export const SURFACE_TO_CLIENT_ARCH = {
  pc: 'pc',
  h5: 'h5',
};

export const PACKAGE_TO_CLIENT_ARCH = {
  'flutter-mobile': 'flutter-mobile',
  'harmony-mobile': 'harmony-mobile',
  'android-mobile': 'android-mobile',
  'ios-mobile': 'ios-mobile',
  'mini-program-weixin': 'mini-program',
  'mini-program-alipay': 'mini-program',
};

export const NGINX_DEFAULTS = {
  clientMaxBodySize: '1100m',
  proxyReadTimeout: '3600s',
  proxySendTimeout: '3600s',
  certRoot: '/etc/sdkwork/certs/letsencrypt',
};
