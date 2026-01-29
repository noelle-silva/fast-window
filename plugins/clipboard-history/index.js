// 剪贴板历史插件 - Material Design 风格
(function() {
  const React = window.React;
  const { useState, useEffect, useRef } = React;
  const api = window.fastWindow;

  const PLUGIN_ID = 'clipboard-history';
  const STORAGE_KEY = 'history';
  const FAVORITES_KEY = 'favorites';
  const SETTINGS_KEY = 'settings';

  const DEFAULT_SETTINGS = {
    maxHistory: 50,
    defaultLines: 6,
    autoMonitor: true,
    pollInterval: 1000,
  };

  // Material Design 颜色
  const MD = {
    primary: '#1976D2',
    primaryLight: '#BBDEFB',
    primaryDark: '#1565C0',
    secondary: '#FF4081',
    surface: '#FFFFFF',
    background: '#FAFAFA',
    error: '#D32F2F',
    onPrimary: '#FFFFFF',
    onSurface: '#212121',
    onSurfaceVariant: '#757575',
    outline: '#E0E0E0',
    elevation1: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
    elevation2: '0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23)',
    elevation3: '0 10px 20px rgba(0,0,0,0.19), 0 6px 6px rgba(0,0,0,0.23)',
    elevation4: '0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22)',
  };

  function ClipboardView({ onBack }) {
    const [history, setHistory] = useState([]);
    const [favorites, setFavorites] = useState([]);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState([]);
    const [expanded, setExpanded] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [contextMenu, setContextMenu] = useState(null);
    const [showFavorites, setShowFavorites] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const currentRef = useRef('');
    const currentImageRef = useRef('');
    // 内部点击“复制”会触发剪贴板变化：用于区分内部/外部变化，避免重复记录
    const internalCopyRef = useRef({ type: '', content: '', at: 0 });

    useEffect(() => {
      Promise.all([
        api.storage.get(PLUGIN_ID, STORAGE_KEY),
        api.storage.get(PLUGIN_ID, FAVORITES_KEY),
        api.storage.get(PLUGIN_ID, SETTINGS_KEY)
      ]).then(([savedHistory, savedFavorites, savedSettings]) => {
        if (savedHistory && Array.isArray(savedHistory)) {
          setHistory(savedHistory);
          const textItems = savedHistory.filter(item => typeof item === 'string' || !item.type);
          if (textItems.length > 0) {
            currentRef.current = typeof textItems[0] === 'string' ? textItems[0] : textItems[0].content;
          }
          const imageItems = savedHistory.filter(item => typeof item === 'object' && item && item.type === 'image' && item.content);
          if (imageItems.length > 0) {
            currentImageRef.current = imageItems[0].content;
          }
        }
        if (savedFavorites && Array.isArray(savedFavorites)) {
          setFavorites(savedFavorites);
        }
        if (savedSettings) {
          setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
        }
        setLoading(false);
      });
    }, []);

    useEffect(() => {
      if (loading || !settings.autoMonitor) return;

      const checkClipboard = async () => {
        // 文本读取失败时，不要影响图片检测（有些剪贴板内容没有 text，会让 readText 抛错）
        try {
          const text = await api.clipboard.readText();
          handleClipboardChange('text', text);
        } catch (e) {}

        try {
          const imageData = await api.clipboard.readImage();
          handleClipboardChange('image', imageData);
        } catch (e) {}
      };

      checkClipboard();
      const interval = setInterval(checkClipboard, settings.pollInterval);
      return () => clearInterval(interval);
    }, [loading, settings.autoMonitor, settings.pollInterval, settings.maxHistory]);

    useEffect(() => {
      const handleClick = () => setContextMenu(null);
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }, []);

    const getContent = (item) => typeof item === 'string' ? item : item.content;
    const getType = (item) => typeof item === 'string' ? 'text' : (item.type || 'text');

    const internalWindowMs = () => Math.max(1500, settings.pollInterval * 2);

    const upsertHistoryItem = (newItem) => {
      setHistory(prev => {
        const type = getType(newItem);
        const content = getContent(newItem);
        const filtered = prev.filter(it => !(getType(it) === type && getContent(it) === content));
        const newHistory = [newItem, ...filtered].slice(0, settings.maxHistory);
        api.storage.set(PLUGIN_ID, STORAGE_KEY, newHistory);
        return newHistory;
      });
    };

    const upsertFavoriteItemIfNeeded = (newItem) => {
      if (!showFavorites) return;
      setFavorites(prev => {
        const type = getType(newItem);
        const content = getContent(newItem);
        const filtered = prev.filter(it => !(getType(it) === type && getContent(it) === content));
        const newFavorites = [newItem, ...filtered];
        api.storage.set(PLUGIN_ID, FAVORITES_KEY, newFavorites);
        return newFavorites;
      });
    };

    const replaceInternalImageIfNeeded = (internalContent, newContent) => {
      if (!internalContent || internalContent === newContent) return;
      const newItem = { type: 'image', content: newContent, time: Date.now() };
      setHistory(prev => {
        const filtered = prev.filter(it => {
          const t = getType(it);
          const c = getContent(it);
          return !(t === 'image' && (c === internalContent || c === newContent));
        });
        const newHistory = [newItem, ...filtered].slice(0, settings.maxHistory);
        api.storage.set(PLUGIN_ID, STORAGE_KEY, newHistory);
        return newHistory;
      });
      if (showFavorites) {
        setFavorites(prev => {
          const filtered = prev.filter(it => {
            const t = getType(it);
            const c = getContent(it);
            return !(t === 'image' && (c === internalContent || c === newContent));
          });
          const newFavorites = [newItem, ...filtered];
          api.storage.set(PLUGIN_ID, FAVORITES_KEY, newFavorites);
          return newFavorites;
        });
      }
    };

    const handleClipboardChange = (type, content) => {
      if (!content) return;

      const internal = internalCopyRef.current;
      const withinWindow = internal.at && (Date.now() - internal.at) < internalWindowMs();
      const isInternal =
        withinWindow &&
        internal.type === type &&
        (type === 'image' ? true : internal.content === content);

      if (isInternal) {
        internalCopyRef.current = { type: '', content: '', at: 0 };
        if (type === 'text') currentRef.current = content;
        if (type === 'image') {
          replaceInternalImageIfNeeded(internal.content, content);
          currentImageRef.current = content;
        }
        return;
      }

      if (internal.at && !withinWindow) {
        internalCopyRef.current = { type: '', content: '', at: 0 };
      }

      if (type === 'text') {
        if (content === currentRef.current) return;
        currentRef.current = content;
      } else if (type === 'image') {
        if (content === currentImageRef.current) return;
        currentImageRef.current = content;
      } else {
        return;
      }

      upsertHistoryItem({ type, content, time: Date.now() });
    };

    const filteredList = (showFavorites ? favorites : history).filter(item => {
      if (searchQuery === '') return true;
      const content = getContent(item);
      if (getType(item) === 'image') return false;
      return content.toLowerCase().includes(searchQuery.toLowerCase());
    });

    const toggleSelect = (item) => {
      if (getType(item) === 'image') return;
      const content = getContent(item);
      setSelected(prev => {
        const index = prev.indexOf(content);
        if (index > -1) return prev.filter(i => i !== content);
        return [...prev, content];
      });
    };

    const handleItemClick = async (e, item) => {
      if (getType(item) === 'image') {
        await copySingle(item);
        setSelected([]);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggleSelect(item);
        return;
      }
      await copySingle(item);
      setSelected([]);
    };

    const toggleExpand = (index) => {
      setExpanded(prev => ({ ...prev, [index]: !prev[index] }));
    };

    const handleContextMenu = (e, item, index) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, item, index });
    };

    const toggleFavorite = async (item) => {
      const content = getContent(item);
      const isFav = favorites.some(f => getContent(f) === content);
      let newFavorites = isFav
        ? favorites.filter(f => getContent(f) !== content)
        : [item, ...favorites];
      setFavorites(newFavorites);
      await api.storage.set(PLUGIN_ID, FAVORITES_KEY, newFavorites);
      setContextMenu(null);
    };

    const copySingle = async (item) => {
      const type = getType(item);
      const content = getContent(item);
      try {
        internalCopyRef.current = { type, content, at: Date.now() };

        if (type === 'image') {
          await api.clipboard.writeImage(content);
          currentImageRef.current = content;
        } else {
          await api.clipboard.writeText(content);
          currentRef.current = content;
        }

        const newItem = { type, content, time: Date.now() };
        upsertHistoryItem(newItem);
        upsertFavoriteItemIfNeeded(newItem);
        api.ui?.showToast?.('复制成功');
      } catch (e) {
        // 静默失败即可，避免打断使用
        internalCopyRef.current = { type: '', content: '', at: 0 };
      }
      setContextMenu(null);
    };

    const getSelectIndex = (item) => {
      const content = getContent(item);
      const index = selected.indexOf(content);
      return index > -1 ? index + 1 : null;
    };

    const copySelected = async () => {
      if (selected.length === 0) return;
      try {
        await api.clipboard.writeText(selected.join('\n'));
        api.ui?.showToast?.('复制成功');
      } catch (e) {
        // 静默失败即可
      }
      setSelected([]);
    };

    const deleteItem = async (e, item) => {
      e.stopPropagation();
      const content = getContent(item);
      const newHistory = history.filter(h => getContent(h) !== content);
      setHistory(newHistory);
      setSelected(prev => prev.filter(s => s !== content));
      await api.storage.set(PLUGIN_ID, STORAGE_KEY, newHistory);
    };

    const clearAll = async () => {
      if (showFavorites) {
        setFavorites([]);
        await api.storage.set(PLUGIN_ID, FAVORITES_KEY, []);
      } else {
        setHistory([]);
        await api.storage.set(PLUGIN_ID, STORAGE_KEY, []);
      }
      setSelected([]);
      setExpanded({});
    };

    const saveSettings = async (newSettings) => {
      setSettings(newSettings);
      await api.storage.set(PLUGIN_ID, SETTINGS_KEY, newSettings);
    };

    const needsExpand = (item) => {
      if (getType(item) === 'image') return false;
      const content = getContent(item);
      return content.split('\n').length > settings.defaultLines || content.length > 400;
    };

    const isFavorite = (item) => {
      const content = getContent(item);
      return favorites.some(f => getContent(f) === content);
    };

    // Loading 状态
    if (loading) {
      return React.createElement('div', {
        style: {
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: MD.background,
          color: MD.onSurfaceVariant,
          fontSize: '14px',
          letterSpacing: '0.25px',
        }
      }, '加载中...');
    }

    // 设置页面
    if (showSettings) {
      return React.createElement('div', {
        style: {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: MD.background,
        }
      },
        // AppBar
        React.createElement('div', {
          style: {
            height: '56px',
            background: MD.surface,
            boxShadow: MD.elevation2,
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            gap: '16px',
            zIndex: 10,
          }
        },
          React.createElement('div', {
            onClick: () => setShowSettings(false),
            style: {
              width: '40px',
              height: '40px',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '20px',
              color: MD.onSurface,
              transition: 'background 0.2s',
            },
            onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)',
            onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
          }, '\u2190'),
          React.createElement('span', {
            style: {
              fontSize: '20px',
              fontWeight: '500',
              color: MD.onSurface,
              letterSpacing: '0.15px',
            }
          }, '设置')
        ),
        // 设置内容
        React.createElement('div', {
          style: { flex: 1, overflow: 'auto', padding: '16px' }
        },
          // 最大历史记录数
          React.createElement('div', {
            style: {
              background: MD.surface,
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '12px',
              boxShadow: MD.elevation1,
            }
          },
            React.createElement('label', {
              style: {
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '500',
                color: MD.onSurface,
                letterSpacing: '0.1px',
              }
            }, '最大历史记录数'),
            React.createElement('input', {
              type: 'number',
              value: settings.maxHistory,
              onChange: (e) => saveSettings({ ...settings, maxHistory: parseInt(e.target.value) || 50 }),
              style: {
                width: '100%',
                padding: '12px 16px',
                fontSize: '16px',
                border: `1px solid ${MD.outline}`,
                borderRadius: '8px',
                background: MD.surface,
                color: MD.onSurface,
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              },
              onFocus: (e) => e.target.style.borderColor = MD.primary,
              onBlur: (e) => e.target.style.borderColor = MD.outline,
            }),
            React.createElement('div', {
              style: {
                fontSize: '12px',
                color: MD.onSurfaceVariant,
                marginTop: '8px',
                letterSpacing: '0.4px',
              }
            }, '超过此数量的旧记录将被自动删除')
          ),
          // 默认显示行数
          React.createElement('div', {
            style: {
              background: MD.surface,
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '12px',
              boxShadow: MD.elevation1,
            }
          },
            React.createElement('label', {
              style: {
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '500',
                color: MD.onSurface,
                letterSpacing: '0.1px',
              }
            }, '默认显示行数'),
            React.createElement('input', {
              type: 'number',
              value: settings.defaultLines,
              onChange: (e) => saveSettings({ ...settings, defaultLines: parseInt(e.target.value) || 6 }),
              style: {
                width: '100%',
                padding: '12px 16px',
                fontSize: '16px',
                border: `1px solid ${MD.outline}`,
                borderRadius: '8px',
                background: MD.surface,
                color: MD.onSurface,
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              },
              onFocus: (e) => e.target.style.borderColor = MD.primary,
              onBlur: (e) => e.target.style.borderColor = MD.outline,
            }),
            React.createElement('div', {
              style: {
                fontSize: '12px',
                color: MD.onSurfaceVariant,
                marginTop: '8px',
                letterSpacing: '0.4px',
              }
            }, '超过此行数的内容将收起显示')
          ),
          // 轮询间隔
          React.createElement('div', {
            style: {
              background: MD.surface,
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '12px',
              boxShadow: MD.elevation1,
            }
          },
            React.createElement('label', {
              style: {
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '500',
                color: MD.onSurface,
                letterSpacing: '0.1px',
              }
            }, '监听间隔 (毫秒)'),
            React.createElement('input', {
              type: 'number',
              value: settings.pollInterval,
              onChange: (e) => saveSettings({ ...settings, pollInterval: parseInt(e.target.value) || 1000 }),
              style: {
                width: '100%',
                padding: '12px 16px',
                fontSize: '16px',
                border: `1px solid ${MD.outline}`,
                borderRadius: '8px',
                background: MD.surface,
                color: MD.onSurface,
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              },
              onFocus: (e) => e.target.style.borderColor = MD.primary,
              onBlur: (e) => e.target.style.borderColor = MD.outline,
            }),
            React.createElement('div', {
              style: {
                fontSize: '12px',
                color: MD.onSurfaceVariant,
                marginTop: '8px',
                letterSpacing: '0.4px',
              }
            }, '检查剪贴板的时间间隔，建议 500-2000')
          ),
          // 自动监听开关
          React.createElement('div', {
            style: {
              background: MD.surface,
              borderRadius: '12px',
              padding: '16px',
              boxShadow: MD.elevation1,
            }
          },
            React.createElement('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }
            },
              React.createElement('div', null,
                React.createElement('div', {
                  style: {
                    fontSize: '14px',
                    fontWeight: '500',
                    color: MD.onSurface,
                    letterSpacing: '0.1px',
                  }
                }, '自动监听剪贴板'),
                React.createElement('div', {
                  style: {
                    fontSize: '12px',
                    color: MD.onSurfaceVariant,
                    marginTop: '4px',
                    letterSpacing: '0.4px',
                  }
                }, '开启后自动记录复制的内容')
              ),
              // Material Switch
              React.createElement('div', {
                onClick: () => saveSettings({ ...settings, autoMonitor: !settings.autoMonitor }),
                style: {
                  width: '52px',
                  height: '32px',
                  borderRadius: '16px',
                  background: settings.autoMonitor ? MD.primaryLight : '#E0E0E0',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                }
              },
                React.createElement('div', {
                  style: {
                    width: '24px',
                    height: '24px',
                    borderRadius: '12px',
                    background: settings.autoMonitor ? MD.primary : '#FAFAFA',
                    position: 'absolute',
                    top: '4px',
                    left: settings.autoMonitor ? '24px' : '4px',
                    transition: 'left 0.2s, background 0.2s',
                    boxShadow: MD.elevation1,
                  }
                })
              )
            )
          ),
          // 危险操作：清空
          React.createElement('div', {
            style: {
              background: MD.surface,
              borderRadius: '12px',
              padding: '16px',
              marginTop: '12px',
              boxShadow: MD.elevation1,
            }
          },
            React.createElement('div', {
              style: {
                fontSize: '14px',
                fontWeight: '500',
                color: MD.onSurface,
                letterSpacing: '0.1px',
                marginBottom: '8px',
              }
            }, '数据管理'),
            React.createElement('div', {
              style: {
                fontSize: '12px',
                color: MD.onSurfaceVariant,
                letterSpacing: '0.4px',
                marginBottom: '12px',
              }
            }, showFavorites ? '将清空所有收藏条目（不可撤销）' : '将清空所有历史记录（不可撤销）'),
            React.createElement('div', {
              onClick: async () => {
                const message = showFavorites
                  ? '确认清空所有收藏？此操作不可撤销。'
                  : '确认清空所有历史记录？此操作不可撤销。';
                if (!window.confirm(message)) return;
                await clearAll();
              },
              style: {
                padding: '10px 16px',
                borderRadius: '20px',
                fontSize: '14px',
                color: MD.error,
                cursor: 'pointer',
                fontWeight: '500',
                textAlign: 'center',
                border: `1px solid ${MD.error}`,
                transition: 'background 0.2s',
                userSelect: 'none',
              },
              onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(211,47,47,0.08)',
              onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
            }, showFavorites ? '清空收藏' : '清空历史')
          )
        )
      );
    }

    // 主界面
    return React.createElement('div', {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        background: MD.background,
      }
    },
      // 搜索栏 - Material Style
      React.createElement('div', {
        style: {
          padding: '8px 12px',
          background: MD.surface,
          boxShadow: MD.elevation1,
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          zIndex: 10,
        }
      },
        React.createElement('div', {
          style: {
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            background: MD.background,
            borderRadius: '20px',
            padding: '0 12px',
            height: '40px',
          }
        },
          React.createElement('span', {
            style: { color: MD.onSurfaceVariant, marginRight: '8px', fontSize: '18px' }
          }, '\uD83D\uDD0D'),
          React.createElement('input', {
            type: 'text',
            placeholder: '搜索剪贴板内容...',
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            style: {
              flex: 1,
              border: 'none',
              background: 'transparent',
              fontSize: '14px',
              color: MD.onSurface,
              outline: 'none',
              letterSpacing: '0.25px',
            }
          })
        ),
        // 设置按钮
        React.createElement('div', {
          onClick: () => setShowSettings(true),
          style: {
            width: '40px',
            height: '40px',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '20px',
            transition: 'background 0.2s',
          },
          onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)',
          onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
        }, '\u2699\uFE0F')
      ),
      // Tab 栏 - Material Tabs
      React.createElement('div', {
        style: {
          display: 'flex',
          background: MD.surface,
          borderBottom: `1px solid ${MD.outline}`,
        }
      },
      React.createElement('div', {
        onClick: () => setShowFavorites(false),
        style: {
          flex: 1,
          padding: '10px',
          textAlign: 'center',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '500',
          letterSpacing: '0.1px',
          color: !showFavorites ? MD.primary : MD.onSurfaceVariant,
          borderBottom: !showFavorites ? `2px solid ${MD.primary}` : '2px solid transparent',
          transition: 'all 0.2s',
          }
        }, `全部 (${history.length})`),
      React.createElement('div', {
        onClick: () => setShowFavorites(true),
        style: {
          flex: 1,
          padding: '10px',
          textAlign: 'center',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: '500',
          letterSpacing: '0.1px',
          color: showFavorites ? MD.primary : MD.onSurfaceVariant,
          borderBottom: showFavorites ? `2px solid ${MD.primary}` : '2px solid transparent',
          transition: 'all 0.2s',
          }
        }, `收藏 (${favorites.length})`)
      ),
      // 列表
      React.createElement('div', {
        style: {
          flex: 1,
          overflow: 'auto',
          background: MD.surface,
        }
      },
        filteredList.length === 0
          ? React.createElement('div', {
              style: {
                padding: '48px 20px',
                textAlign: 'center',
                color: MD.onSurfaceVariant,
                fontSize: '14px',
                letterSpacing: '0.25px',
              }
            }, searchQuery ? '没有匹配的内容' : (showFavorites ? '暂无收藏' : '剪贴板历史为空'))
          : filteredList.map((item, index) => {
              const type = getType(item);
              const content = getContent(item);
              const selectIndex = getSelectIndex(item);
              const isSelected = selectIndex !== null;
              const isExpanded = expanded[index];
              const showExpand = needsExpand(item);
              const isFav = isFavorite(item);

              return React.createElement('div', {
                key: index,
                onClick: (e) => handleItemClick(e, item),
                onContextMenu: (e) => handleContextMenu(e, item, index),
                onMouseEnter: (e) => {
                  if (isSelected) return;
                  e.currentTarget.style.background = 'rgba(0,0,0,0.03)';
                },
                onMouseLeave: (e) => {
                  e.currentTarget.style.background = isSelected ? 'rgba(25,118,210,0.06)' : 'transparent';
                },
                style: {
                  padding: '12px 12px',
                  background: isSelected ? 'rgba(25,118,210,0.06)' : 'transparent',
                  borderBottom: `1px solid ${MD.outline}`,
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  position: 'relative',
                }
              },
                // 收藏标记
                isFav && React.createElement('div', {
                  style: {
                    position: 'absolute',
                    top: '10px',
                    right: '12px',
                    fontSize: '16px',
                  }
                }, '\u2B50'),
                // 选中顺序标记（Ctrl 多选）
                isSelected && React.createElement('div', {
                  style: {
                    position: 'absolute',
                    top: '10px',
                    right: isFav ? '36px' : '12px',
                    minWidth: '20px',
                    height: '20px',
                    padding: '0 6px',
                    borderRadius: '10px',
                    background: MD.primary,
                    color: MD.onPrimary,
                    fontSize: '12px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    letterSpacing: '0.2px',
                    userSelect: 'none',
                  }
                }, String(selectIndex)),
                // 内容区
                React.createElement('div', {
                  style: { display: 'flex', alignItems: 'flex-start', gap: '12px' }
                },
                  // 内容
                  type === 'image'
                    ? React.createElement('div', {
                        style: {
                          flex: 1,
                          maxHeight: isExpanded ? 'none' : '150px',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          textAlign: 'center',
                        }
                      },
                        React.createElement('img', {
                          src: content,
                          style: {
                            display: 'block',
                            maxWidth: '100%',
                            maxHeight: isExpanded ? 'none' : '150px',
                            objectFit: 'contain',
                            borderRadius: '8px',
                          }
                        }),
                        React.createElement('div', {
                          style: {
                            width: '100%',
                            fontSize: '12px',
                            color: MD.onSurfaceVariant,
                            marginTop: '8px',
                            letterSpacing: '0.4px',
                          }
                        }, '\uD83D\uDDBC\uFE0F 图片')
                      )
                    : React.createElement('div', {
                        style: {
                          flex: 1,
                          fontSize: '14px',
                          lineHeight: '1.6',
                          overflow: 'hidden',
                          whiteSpace: 'pre-wrap',
                          display: isExpanded ? 'block' : '-webkit-box',
                          WebkitLineClamp: isExpanded ? 'unset' : settings.defaultLines,
                          WebkitBoxOrient: 'vertical',
                          wordBreak: 'break-all',
                          color: MD.onSurface,
                          paddingRight: isFav ? '24px' : '0',
                          letterSpacing: '0.25px',
                        }
                      }, content),
                  // 删除按钮
                  !showFavorites && React.createElement('div', {
                    onClick: (e) => deleteItem(e, item),
                    style: {
                      width: '32px',
                      height: '32px',
                      borderRadius: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '18px',
                      color: MD.onSurfaceVariant,
                      flexShrink: 0,
                      transition: 'background 0.2s',
                    },
                    onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)',
                    onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
                  }, '\u00D7')
                ),
                // 展开提示
                showExpand && React.createElement('div', {
                  onClick: (e) => { e.stopPropagation(); toggleExpand(index); },
                  style: {
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: `1px solid ${MD.outline}`,
                    fontSize: '14px',
                    color: MD.primary,
                    textAlign: 'center',
                    fontWeight: '500',
                    letterSpacing: '0.1px',
                  }
                }, isExpanded ? '收起' : '展开全部')
              );
            })
      ),
      // 右键菜单 - Material Menu
      contextMenu && React.createElement('div', {
        style: {
          position: 'fixed',
          left: contextMenu.x,
          top: contextMenu.y,
          background: MD.surface,
          borderRadius: '8px',
          boxShadow: MD.elevation3,
          zIndex: 1000,
          minWidth: '160px',
          overflow: 'hidden',
          padding: '8px 0',
        }
      },
        React.createElement('div', {
          onClick: () => copySingle(contextMenu.item),
          style: {
            padding: '12px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            color: MD.onSurface,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            letterSpacing: '0.25px',
            transition: 'background 0.15s',
          },
          onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)',
          onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
        }, '\uD83D\uDCCB', ' 复制'),
        React.createElement('div', {
          onClick: () => toggleFavorite(contextMenu.item),
          style: {
            padding: '12px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            color: MD.onSurface,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            letterSpacing: '0.25px',
            transition: 'background 0.15s',
          },
          onMouseEnter: (e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)',
          onMouseLeave: (e) => e.currentTarget.style.background = 'transparent',
        }, isFavorite(contextMenu.item) ? '\uD83D\uDC94' : '\u2B50', isFavorite(contextMenu.item) ? ' 取消收藏' : ' 收藏')
      ),
      // FAB 按钮 - Material FAB
      selected.length > 0 && React.createElement('div', {
        onClick: copySelected,
        style: {
          position: 'absolute',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: MD.primary,
          color: MD.onPrimary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: MD.elevation3,
          fontSize: '24px',
          transition: 'transform 0.2s, box-shadow 0.2s',
        },
        onMouseEnter: (e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = MD.elevation4;
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = MD.elevation3;
        },
      }, '\uD83D\uDCCB')
    );
  }

  window.registerPluginComponent('clipboard-history', ClipboardView);
})();
