/**
 * Browser half of the Git graph watermark bundle.
 *
 * One click-through tree in the empty right margin of the conversation column:
 * the current branch's HEAD on a vertical trunk, and every nearby branch drawn
 * as a dashed link from its fork point to its newest commit. Branch dots are
 * plain HTML on top of the drawing, so they stay hoverable above the scrolling
 * conversation. Hovering a dot reports that commit's time, short hash, and
 * whether the branch is local or remote.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-git-graph-watermark',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Document-relative route registered by this bundle's Host half. */
    const ROUTE = 'api/plugin/git-graph-watermark';
    /** Locale namespace owned by this bundle. */
    const NS = 'branchTree';
    /** Slow safety refresh while the page stays visible. */
    const REFRESH_MS = 90_000;
    /** Narrowest right margin that can hold the tree. */
    const MIN_GUTTER = 104;
    /** 水墨丹青: the first pigment marks the current branch and the trunk. */
    const PIGMENTS = [
      '#B23A2E',
      '#33587D',
      '#4F7D63',
      '#B8912E',
      '#8E2F3C',
      '#8A5A3B',
      '#4B4F55',
      '#4A6A73',
    ];
    /** Fallback hook so a slot without a session seat still renders inert. */
    const EMPTY_HOOK = (selector) => selector(undefined);

    /**
     * Keep a pigment readable on both themes by mixing in the theme's ink.
     * @param {number} index - pigment index.
     * @returns {string} a CSS color.
     */
    function ink(index) {
      const pigment = PIGMENTS[index % PIGMENTS.length];
      return `color-mix(in srgb, ${pigment} 84%, var(--dsw-alias-label-primary))`;
    }

    /**
     * Commit time in the reader's own clock.
     * @param {number} seconds - epoch seconds.
     * @returns {string} `MM-DD HH:mm`, with the year only when it differs from now.
     */
    function formatWhen(seconds) {
      if (!Number.isFinite(seconds) || seconds <= 0) return '';
      const date = new Date(seconds * 1000);
      const now = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      const clock = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      return date.getFullYear() === now.getFullYear() ? clock : `${date.getFullYear()}-${clock}`;
    }

    /**
     * Fit a branch name into the label rail, preferring its distinctive tail.
     * @param {string} name - branch name.
     * @param {number} maxChars - characters that fit.
     * @returns {string} a name within the rail width.
     */
    function shorten(name, maxChars) {
      const text = String(name);
      if (text.length <= maxChars) return text;
      const tail = text.includes('/') ? text.slice(text.lastIndexOf('/') + 1) : text;
      const candidate = tail.length > 0 && tail.length < text.length ? tail : text;
      return candidate.length <= maxChars ? candidate : `${candidate.slice(0, Math.max(1, maxChars - 1))}…`;
    }

    /**
     * Lay the tree out inside the measured right margin.
     * @param {object} graph - host snapshot.
     * @param {{width: number, height: number}} box - measured wrapper size.
     * @returns {object|null} geometry, or null when the margin is too narrow.
     */
    function layout(graph, box) {
      const column = box.width + 48;
      const content = Math.min(920, Math.max(680, column * 0.64));
      const gutter = (box.width - content) / 2 - 10;
      if (gutter < MIN_GUTTER) return null;

      const artLeft = box.width - gutter;
      const trunkX = box.width - 10;
      const tipX = trunkX - Math.min(30, Math.max(20, gutter * 0.22));
      const labelX = tipX - 8;
      const labelWidth = Math.max(40, labelX - artLeft - 4);
      const maxChars = Math.min(34, Math.max(8, Math.floor(labelWidth / 5.6)));
      const top = 56;
      const bottom = box.height - 24;
      const lanes = graph.branches.map((branch, index) => ({
        branch,
        color: ink(index + 1),
        y: 0,
      }));
      const step = lanes.length <= 1 ? 0 : Math.min(52, (bottom - top) / (lanes.length - 1));
      lanes.forEach((lane, index) => { lane.y = top + index * step; });

      return {
        artLeft,
        trunkX,
        tipX,
        labelX,
        bottom,
        headY: 30,
        lanes,
        maxChars,
      };
    }

    /**
     * The tree itself.
     * @param {object} props - Session-scoped slot props with global standard hooks.
     * @returns {object|null} the decoration, or its empty measuring box.
     */
    function Watermark(props) {
      const { sessionId } = props;
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const useSession = typeof props.useSession === 'function' ? props.useSession : EMPTY_HOOK;
      const useWorkspaces = typeof props.useWorkspaces === 'function' ? props.useWorkspaces : EMPTY_HOOK;

      const running = useSession((state) => (state === undefined || state === null ? undefined : state.running));
      const path = useWorkspaces((state) => {
        const items = state === undefined || state === null ? [] : state.items;
        for (const item of items) {
          if (Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId)) return item.path;
        }
        return undefined;
      });

      const boxRef = React.useRef(null);
      const pathRef = React.useRef(path);
      pathRef.current = path;
      const [graph, setGraph] = React.useState(null);
      const [box, setBox] = React.useState({ width: 0, height: 0 });
      const [hover, setHover] = React.useState(null);

      const load = React.useCallback(async (fresh) => {
        const directory = pathRef.current;
        if (typeof directory !== 'string' || directory === '') return;
        try {
          const query = `?path=${encodeURIComponent(directory)}${fresh ? '&fresh=1' : ''}`;
          const response = await fetch(`${ROUTE}${query}`, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
          });
          if (!response.ok) return;
          const value = await response.json();
          setGraph(value !== null && typeof value === 'object' && value.available === true ? value : null);
          setHover(null);
        } catch {
          // Decorative: a failed read leaves the previous drawing in place.
        }
      }, []);

      React.useEffect(() => {
        setGraph(null);
        setHover(null);
        if (path !== undefined) load(true);
      }, [path, load]);

      React.useEffect(() => {
        const timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') load(false);
        }, REFRESH_MS);
        return () => window.clearInterval(timer);
      }, [load]);

      React.useEffect(() => {
        const onVisibility = () => {
          if (document.visibilityState === 'visible') load(false);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
      }, [load]);

      React.useEffect(() => {
        if (running === false) load(true);
      }, [running, load]);

      React.useEffect(() => {
        const node = boxRef.current;
        if (node === null || typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver((entries) => {
          const rect = entries[0] === undefined ? undefined : entries[0].contentRect;
          if (rect === undefined) return;
          const width = Math.round(rect.width);
          const height = Math.round(rect.height);
          setBox((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
        });
        observer.observe(node);
        return () => observer.disconnect();
      }, []);

      const geometry = graph === null || box.width === 0 ? null : layout(graph, box);
      const baseStyle = {
        position: 'absolute',
        top: 84,
        right: 0,
        width: '100%',
        height: 'min(56vh, 500px)',
        pointerEvents: 'none',
        fontFamily: 'var(--dsh-font-family-code, ui-monospace, monospace)',
      };
      if (geometry === null) {
        return h('div', { ref: boxRef, style: baseStyle, 'aria-hidden': 'true' });
      }

      const children = [h('div', {
        key: 'art',
        style: {
          position: 'absolute',
          inset: 0,
          maskImage: 'linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%)',
        },
      }, draw(graph, box, geometry))];

      const nodes = [{ kind: 'head', x: geometry.trunkX, y: geometry.headY, color: ink(0), remote: false, commit: graph.head }];
      for (const lane of geometry.lanes) {
        nodes.push({
          kind: 'branch',
          x: geometry.tipX,
          y: lane.y,
          color: lane.color,
          remote: lane.branch.remote === true,
          commit: lane.branch.tip,
        });
      }
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        children.push(h('div', {
          key: `node-${index}`,
          style: {
            position: 'absolute',
            left: node.x - 10,
            top: node.y - 10,
            width: 20,
            height: 20,
            pointerEvents: 'auto',
            cursor: 'default',
          },
          onMouseEnter: () => setHover(node),
          onMouseLeave: () => setHover(null),
        }, h('span', {
          style: node.remote
            ? {
              position: 'absolute',
              left: node.kind === 'head' ? 5 : 6,
              top: node.kind === 'head' ? 5 : 6,
              width: node.kind === 'head' ? 10 : 8,
              height: node.kind === 'head' ? 10 : 8,
              borderRadius: '50%',
              border: `1.5px solid ${node.color}`,
              boxSizing: 'border-box',
            }
            : {
              position: 'absolute',
              left: node.kind === 'head' ? 5 : 6,
              top: node.kind === 'head' ? 5 : 6,
              width: node.kind === 'head' ? 10 : 8,
              height: node.kind === 'head' ? 10 : 8,
              borderRadius: '50%',
              background: node.color,
              boxShadow: node.kind === 'head' ? `0 0 0 5px color-mix(in srgb, ${node.color} 18%, transparent)` : 'none',
            },
        })));
      }

      if (hover !== null) {
        const above = hover.y > 120;
        children.push(h('div', {
          key: 'card',
          style: {
            position: 'absolute',
            left: hover.x - 14,
            top: above ? hover.y - 12 : hover.y + 14,
            transform: above ? 'translate(-100%, -100%)' : 'translate(-100%, 0)',
            padding: '6px 10px',
            borderRadius: 8,
            border: '0.5px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-overlay)',
            color: 'var(--dsw-alias-label-primary)',
            fontFamily: 'var(--dsh-font-family-code, ui-monospace, monospace)',
            fontSize: 10.5,
            lineHeight: '16px',
            whiteSpace: 'nowrap',
            zIndex: 4,
          },
        }, [
          h('span', {
            key: 'tag',
            style: { color: ink(0), marginRight: 6 },
          }, t(hover.remote ? 'remote' : 'local')),
          h('span', { key: 'when', style: { color: 'var(--dsw-alias-label-secondary)' } }, formatWhen(hover.commit.t)),
          h('span', { key: 'hash', style: { color: 'var(--dsw-alias-label-tertiary)', marginLeft: 6 } }, hover.commit.h),
        ]));
      }

      return h('div', {
        ref: boxRef,
        style: { ...baseStyle, zIndex: 3 },
        'aria-hidden': 'true',
        'data-git-graph-watermark': '',
      }, children);
    }

    /**
     * Draw trunk, forks, and labels.
     * @param {object} graph - host snapshot.
     * @param {{width: number, height: number}} box - measured wrapper size.
     * @param {object} geometry - laid out axes.
     * @returns {object} the SVG element.
     */
    function draw(graph, box, geometry) {
      const { trunkX, tipX, labelX, headY, bottom, lanes, maxChars } = geometry;
      const accent = ink(0);
      const parts = [];
      const lastFork = lanes.length === 0 ? headY : Math.min(bottom, lanes[lanes.length - 1].y + 18);

      parts.push(h('line', {
        key: 'trunk',
        x1: trunkX,
        y1: headY,
        x2: trunkX,
        y2: lastFork,
        stroke: accent,
        strokeOpacity: 0.4,
        strokeWidth: 1.5,
        strokeLinecap: 'round',
      }));

      for (let index = 0; index < lanes.length; index += 1) {
        const lane = lanes[index];
        const forkY = Math.min(bottom, lane.y + 16);
        const mid = (forkY + lane.y) / 2;
        parts.push(h('path', {
          key: `link-${index}`,
          d: `M ${trunkX} ${forkY} C ${trunkX} ${mid} ${tipX} ${mid} ${tipX} ${lane.y}`,
          fill: 'none',
          stroke: lane.color,
          strokeOpacity: 0.62,
          strokeWidth: 1.2,
          strokeDasharray: '3 3',
          strokeLinecap: 'round',
        }));
        parts.push(h('circle', {
          key: `fork-${index}`,
          cx: trunkX,
          cy: forkY,
          r: 2.2,
          fill: lane.color,
          fillOpacity: 0.5,
        }));
        parts.push(h('text', {
          key: `label-${index}`,
          x: labelX,
          y: lane.y + 3.2,
          fontSize: 9.5,
          textAnchor: 'end',
          fill: lane.color,
          fillOpacity: 0.92,
        }, shorten(lane.branch.name, maxChars)));
      }

      const dirty = typeof graph.dirty === 'number' && graph.dirty > 0;
      parts.push(h('text', {
        key: 'caption',
        x: labelX,
        y: 12,
        fontSize: 9.5,
        letterSpacing: 0.2,
        textAnchor: 'end',
        fill: accent,
        fillOpacity: 0.85,
      }, h('tspan', null, shorten(`${graph.branch} · ${graph.branchCount}`, maxChars)), dirty ? h('tspan', {
        fill: 'var(--dsw-alias-state-warn-primary)',
        fillOpacity: 0.9,
      }, ` +${graph.dirty}`) : null));

      return h('svg', {
        width: box.width,
        height: box.height,
        viewBox: `0 0 ${box.width} ${box.height}`,
        style: { position: 'absolute', inset: 0, overflow: 'hidden' },
      }, parts);
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the tree and its two dictionary words.
       * @param {object} ctx - Client root context.
       */
      apply(ctx) {
        ctx.effect(() => {
          const zh = ctx.locale.register(NS, 'zh', { local: '本地', remote: '远端' });
          const en = ctx.locale.register(NS, 'en', { local: 'local', remote: 'remote' });
          return () => {
            zh();
            en();
          };
        }, 'git-graph-watermark: dictionaries');
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'git-graph-watermark',
          order: 90,
          locale: NS,
        }, Watermark));
      },
    };
  },
});
