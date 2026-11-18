export default defineAppConfig({
  pages: ['pages/assistant/index', 'pages/trips/index', 'pages/favorites/index', 'pages/profile/index'],
  window: {
    navigationBarTitleText: '远行 Roam',
    navigationBarBackgroundColor: '#f7f4eb',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f7f4eb',
    backgroundTextStyle: 'dark'
  },
  tabBar: {
    color: '#596b60', selectedColor: '#183f3c', backgroundColor: '#f7f4eb', borderStyle: 'white',
    list: [
      { pagePath: 'pages/assistant/index', text: '助手', iconPath: 'assets/tabs/compass.png', selectedIconPath: 'assets/tabs/compass-active.png' },
      { pagePath: 'pages/trips/index', text: '行程', iconPath: 'assets/tabs/map.png', selectedIconPath: 'assets/tabs/map-active.png' },
      { pagePath: 'pages/favorites/index', text: '收藏', iconPath: 'assets/tabs/bookmark.png', selectedIconPath: 'assets/tabs/bookmark-active.png' },
      { pagePath: 'pages/profile/index', text: '我的', iconPath: 'assets/tabs/user.png', selectedIconPath: 'assets/tabs/user-active.png' }
    ]
  },
  lazyCodeLoading: 'requiredComponents'
});
