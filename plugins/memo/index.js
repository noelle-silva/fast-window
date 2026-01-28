// 快捷备忘录插件
(function() {
  const React = window.React;
  const { useState, useEffect } = React;
  const api = window.fastWindow;

  const PLUGIN_ID = 'memo';
  const STORAGE_KEY = 'items';

  function MemoView({ onBack }) {
    const [memos, setMemos] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      // 加载数据
      api.storage.get(PLUGIN_ID, STORAGE_KEY).then(saved => {
        if (saved) {
          setMemos(saved);
        }
        setLoading(false);
      });
    }, []);

    const saveMemos = async (newMemos) => {
      setMemos(newMemos);
      await api.storage.set(PLUGIN_ID, STORAGE_KEY, newMemos);
    };

    const addMemo = () => {
      if (!input.trim()) return;
      const newMemo = {
        id: Date.now().toString(),
        content: input.trim(),
        createdAt: Date.now(),
      };
      saveMemos([newMemo, ...memos]);
      setInput('');
    };

    const deleteMemo = (id) => {
      saveMemos(memos.filter(m => m.id !== id));
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        addMemo();
      }
    };

    if (loading) {
      return React.createElement('div', {
        style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }
      }, '加载中...');
    }

    return React.createElement('div', {
      style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
    },
      React.createElement('div', { style: { padding: '12px' } },
        React.createElement('textarea', {
          value: input,
          onChange: (e) => setInput(e.target.value),
          onKeyDown: handleKeyDown,
          placeholder: '输入备忘内容，Enter 保存...',
          style: {
            width: '100%',
            padding: '12px',
            fontSize: '14px',
            border: 'none',
            borderRadius: '8px',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            resize: 'none',
            height: '60px',
            outline: 'none',
          }
        })
      ),
      React.createElement('div', {
        style: { flex: 1, overflow: 'auto', padding: '0 12px 12px' }
      },
        memos.length === 0
          ? React.createElement('div', {
              style: { padding: '20px', textAlign: 'center', color: '#666' }
            }, '暂无备忘')
          : memos.map(memo =>
              React.createElement('div', {
                key: memo.id,
                style: {
                  padding: '12px 16px',
                  marginBottom: '8px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '8px',
                  position: 'relative',
                }
              },
                React.createElement('div', {
                  style: { fontSize: '13px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }
                }, memo.content),
                React.createElement('div', {
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '8px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                  }
                },
                  React.createElement('span', null, new Date(memo.createdAt).toLocaleString()),
                  React.createElement('span', {
                    onClick: () => deleteMemo(memo.id),
                    style: { cursor: 'pointer', color: '#e74c3c' }
                  }, '删除')
                )
              )
            )
      )
    );
  }

  window.registerPluginComponent('memo', MemoView);
})();
