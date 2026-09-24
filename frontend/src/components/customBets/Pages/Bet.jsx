import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { customBetsAPI } from "../../../services/api";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";

import MobileSheet from "../Components/MobileSheet";
import ChanceGraph from "../Components/ChanceGraph";
import SlotRollingNumber from "../Components/SlotRollingNumber";
import DepositToastStack from "../Components/DepositToastStack";

import styles from "./Bet.module.css";

function fmtEndsBadge(end_at) {
  const t = new Date(end_at).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function fmtEndsMeta(end_at) {
  const t = new Date(end_at).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString();
}

function calcPercents(market) {
  const opts = market.options || [];
  if (!opts.length) return [];

  if (market.show_percentages) {
    const vals = opts.map((o) =>
      Number.isFinite(Number(o.creator_percent)) ? Number(o.creator_percent) : null
    );
    const any = vals.some((v) => v != null);
    if (any) return vals.map((v) => (v == null ? 0 : v));
  }

  const totals = opts.map((o) => Number(o.total || 0));
  const sum = totals.reduce((a, b) => a + b, 0) || 0;
  if (!sum) return totals.map(() => 0);
  return totals.map((t) => (t / sum) * 100);
}

function clampCentsFromPct(pct) {
  const x = Math.round(Number(pct) || 0);
  return Math.min(99, Math.max(1, x));
}

function useIsMobile() {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 980px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 980px)");
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return mobile;
}

function dayKeyLocal(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function dayLabelFromKey(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayLabelLongFromKey(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function calcAvgPriceCents(optionTotal, poolTotal) {
  const t = Number(optionTotal || 0);
  const p = Number(poolTotal || 0);
  if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) return null;
  const cents = (t / p) * 100;
  return Math.max(1, Math.min(99, cents));
}

function MenuItemIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 18 18" aria-hidden="true" focusable="false" {...props}>
      <line x1="1.75" y1="15.75" x2="8.25" y2="15.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <line x1="2.757" y1="8.914" x2="9.414" y2="2.257" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <line x1="6.336" y1="12.493" x2="2.257" y2="8.414" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <line x1="12.493" y1="5.336" x2="5.836" y2="11.993" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <line x1="8.914" y1="1.757" x2="12.993" y2="5.836" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M8.163,9.665l4.664,4.667c.552,.552,1.448,.552,2,0s.552-1.448,0-2l-4.667-4.665" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function PastCaretIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12px" height="12px" viewBox="0 0 12 12" aria-hidden="true" focusable="false" {...props}>
      <polyline points="1.75 4.25 6 8.5 10.25 4.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function HeartOutlineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20.8 4.6c-2.2-2-5.6-1.8-7.6.6L12 6.4l-1.2-1.2c-2-2.4-5.4-2.6-7.6-.6-2.4 2.2-2.4 5.8-.2 8.2L12 21l9-8.2c2.2-2.4 2.2-6-.2-8.2z" />
    </svg>
  );
}

function HeartFilledIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 21s-7-4.534-9.33-8.44C.85 9.4 2.28 6.5 5.2 5.44 7.02 4.78 9.06 5.3 10.5 6.7L12 8.2l1.5-1.5c1.44-1.4 3.48-1.92 5.3-1.26 2.92 1.06 4.35 3.96 2.53 7.12C19 16.466 12 21 12 21z" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10 9V5l-7 7 7 7v-4c7 0 11 2 14 7-1-9-6-13-14-13z" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 2l8 4v6c0 5-3 9-8 10-5-1-8-5-8-10V6l8-4z" />
    </svg>
  );
}

// --- time parsing fixes ---
function normalizeSqliteDate(s) {
  const str = String(s || "");
  if (!str) return null;

  if (str.includes("T") && (str.endsWith("Z") || /[+-]\d\d:\d\d$/.test(str))) return str;

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str)) {
    return str.replace(" ", "T") + "Z";
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str) && !str.endsWith("Z") && !/[+-]\d\d:\d\d$/.test(str)) {
    return str + "Z";
  }

  return str;
}

function timeAgo(isoLike) {
  const norm = normalizeSqliteDate(isoLike);
  const t = norm ? new Date(norm).getTime() : NaN;
  if (!Number.isFinite(t)) return "";

  const diffMs = Date.now() - t;
  const s = Math.floor(diffMs / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function badgeTextFromDate(isoLike) {
  const norm = normalizeSqliteDate(isoLike);
  const t = norm ? new Date(norm).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function avatarColorFromName(name) {
  const str = String(name || "u");
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 85% 60%), hsl(${(hue + 60) % 360} 85% 55%))`;
}

// --- tree update helpers (optimistic updates) ---
function updateCommentTree(tree, predicate, updater) {
  const walk = (nodes) =>
    nodes.map((n) => {
      if (predicate(n)) return updater(n);
      if (Array.isArray(n.replies) && n.replies.length) {
        const nextReplies = walk(n.replies);
        if (nextReplies !== n.replies) return { ...n, replies: nextReplies };
      }
      return n;
    });
  return walk(Array.isArray(tree) ? tree : []);
}

function removeFromCommentTree(tree, id) {
  const walk = (nodes) =>
    nodes
      .filter((n) => Number(n.id) !== Number(id))
      .map((n) => {
        if (Array.isArray(n.replies) && n.replies.length) {
          const nextReplies = walk(n.replies);
          if (nextReplies !== n.replies) return { ...n, replies: nextReplies };
        }
        return n;
      });
  return walk(Array.isArray(tree) ? tree : []);
}

export default function Bet() {
  const { betId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, refreshUser, isAuthenticated } = useAuth();

  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState(null);

  const [selectedOptionId, setSelectedOptionId] = useState(null);

  // amount
  const [amountStr, setAmountStr] = useState("0");
  const amount = Number(String(amountStr).replace(/[^\d.]/g, "") || 0);
  const [buying, setBuying] = useState(false);
  const isTypingAmount = amount > 0;

  // graph
  const [graphPoints, setGraphPoints] = useState([]);
  const [graphLoading, setGraphLoading] = useState(false);
  const [bucketMinutes, setBucketMinutes] = useState(10);

  // date pills
  const [pastOpen, setPastOpen] = useState(false);
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  // hover chance
  const [hoverChance, setHoverChance] = useState(null);

  // animation keys
  const [graphRedrawNonce, setGraphRedrawNonce] = useState(0);
  const [graphMorphNonce, setGraphMorphNonce] = useState(0);

  // sticky overlay header state
  const [floatOn, setFloatOn] = useState(false);

  // comments
  const [comments, setComments] = useState([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentSaving, setCommentSaving] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState("");

  const [replyOpenFor, setReplyOpenFor] = useState(null);
  const [replyBody, setReplyBody] = useState("");

  // collapse replies
  const [collapsed, setCollapsed] = useState(() => new Set());

  // per-comment menu (works for replies too)
  const [menuOpenId, setMenuOpenId] = useState(null);

  // owner/admin actions
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const [actionBusy, setActionBusy] = useState(false);

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveOptionId, setResolveOptionId] = useState(null);

  const [closeOpen, setCloseOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  // mobile sheet (BUY PANEL ONLY)
  const [sheetOpen, setSheetOpen] = useState(false);

  // mobile detail panel (Screen 2)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // options dropdown in sidebar (desktop)
  const [optionsOpen, setOptionsOpen] = useState(false);

  // deposit toast stack
  const [depositToasts, setDepositToasts] = useState([]);

  // Back to top
  const [showBackTop, setShowBackTop] = useState(false);

  // comment header UI state (visual only)
  const [sortOpen, setSortOpen] = useState(false);
  const [holdersOnly, setHoldersOnly] = useState(false);

  const pastWrapRef = useRef(null);
  const optionsWrapRef = useRef(null);
  const menuWrapRef = useRef(null);

  useEffect(() => {
    const onScroll = () => {
      setFloatOn(window.scrollY > 120);
      setShowBackTop(window.scrollY > 800);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // close menus on outside click
  useEffect(() => {
    const onDoc = (e) => {
      if (pastWrapRef.current && !pastWrapRef.current.contains(e.target)) setPastOpen(false);
      if (optionsWrapRef.current && !optionsWrapRef.current.contains(e.target)) setOptionsOpen(false);
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target)) setMenuOpenId(null);
      setSortOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const loadMarket = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customBetsAPI.get(betId);
      const m = res.data?.data;
      setMarket(m);

      const first = m?.options?.[0]?.id ?? null;
      setSelectedOptionId((prev) => prev ?? first);
      setResolveOptionId((prev) => prev ?? first);
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to load market");
      setMarket(null);
    } finally {
      setLoading(false);
    }
  }, [betId, toast]);

  const loadComments = useCallback(async () => {
    setCommentsLoading(true);
    try {
      const res = await customBetsAPI.listComments(betId, { limit: 200, offset: 0 });
      setComments(res.data?.data ?? []);
    } catch (e) {
      console.warn("comments load failed", e);
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [betId]);

  const loadGraph = useCallback(
    async (optId = selectedOptionId, bucket = bucketMinutes) => {
      if (!optId) return;
      setGraphLoading(true);
      try {
        const res = await customBetsAPI.graph(betId, { optionId: optId, bucketMinutes: bucket });
        setGraphPoints(res.data?.data ?? []);
      } catch {
        setGraphPoints([]);
      } finally {
        setGraphLoading(false);
      }
    },
    [betId, bucketMinutes, selectedOptionId]
  );

  useEffect(() => {
    loadMarket();
    loadComments();
  }, [betId, loadMarket, loadComments]);

  const options = market?.options || [];
  const percents = useMemo(() => (market ? calcPercents(market) : []), [market]);

  const selectedIndex = useMemo(() => {
    if (!market || !selectedOptionId) return -1;
    return (market.options || []).findIndex((o) => Number(o.id) === Number(selectedOptionId));
  }, [market, selectedOptionId]);

  const selectedOption = useMemo(() => {
    if (!market || !selectedOptionId) return null;
    return (market.options || []).find((o) => Number(o.id) === Number(selectedOptionId)) || null;
  }, [market, selectedOptionId]);

  const selectedPct = Number(percents[selectedIndex] || 0);
  const selectCents = clampCentsFromPct(selectedPct);

  const avgPriceCents = useMemo(() => {
    if (!market || selectedIndex < 0) return null;
    const opt = market.options?.[selectedIndex];
    const poolTotal = Number(market.pool_total || 0);
    return calcAvgPriceCents(opt?.total, poolTotal);
  }, [market, selectedIndex]);

  const endAtMs = useMemo(() => {
    const t = new Date(market?.end_at).getTime();
    return Number.isFinite(t) ? t : null;
  }, [market?.end_at]);

  const ended = endAtMs ? Date.now() >= endAtMs : false;
  const status = market?.status || "open";

  const isOpen = status === "open" && !ended;
  const isResolved = status === "resolved";
  const isRemoved = status === "removed";

  const canReopen = status === "closed" && !ended && !isResolved && !isRemoved;
  const closeLabel = canReopen ? "Reopen" : ended && status === "closed" ? "Ended" : "Close";

  const toWin = useMemo(() => {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return amount * 2;
  }, [amount]);

  const canBuy = Boolean(isAuthenticated && isOpen && selectedOptionId && amount > 0 && !buying);

  useEffect(() => {
    loadGraph(selectedOptionId, bucketMinutes);
  }, [bucketMinutes, betId, selectedOptionId, loadGraph]);

  useEffect(() => {
    setGraphMorphNonce((n) => n + 1);
  }, [bucketMinutes, selectedOptionId]);

  useEffect(() => {
    setGraphRedrawNonce((n) => n + 1);
  }, [selectedDayKey]);

  const selectOptionFn = (id, { openSheetOnMobile = true } = {}) => {
    setSelectedOptionId(id);
    setHoverChance(null);
    if (openSheetOnMobile && isMobile) setMobileDetailOpen(true);
  };

  const pushDepositToast = (text) => {
    const id = Date.now() + Math.random();
    console.log('🔥 PUSHING TOAST:', { id, text });
    setDepositToasts((prev) => {
      const next = [...prev, { id, text, durationMs: 2200 }];
      console.log('📊 Toast state:', next);
      return next;
    });
  };

  const buy = async () => {
    if (!market || !canBuy) return;
    setBuying(true);
    const depositAmount = Number(amount);

    try {
      const res = await customBetsAPI.buy(market.id, {
        optionId: selectedOptionId,
        amount: depositAmount,
      });
      const updated = res.data?.data?.bet;

      setAmountStr("0");
      await refreshUser?.();

      if (updated) setMarket(updated);
      else await loadMarket();

      await loadGraph(selectedOptionId, bucketMinutes);

      setSheetOpen(false);
      if (isMobile) setMobileDetailOpen(true);

      pushDepositToast(`+$${depositAmount.toLocaleString()} deposited!`);
    } catch (e) {
      toast.error(e.response?.data?.message || "Deposit failed");
    } finally {
      setBuying(false);
    }
  };

  const quickAdd = (v) => {
    const cur = Number(String(amountStr).replace(/[^\d.]/g, "") || 0);
    const next = (Number.isFinite(cur) ? cur : 0) + v;
    setAmountStr(next <= 0 ? "0" : String(next));
  };

  const setMax = () => {
    const b = Number(user?.balance ?? 0);
    setAmountStr(String(Math.floor(Number.isFinite(b) ? b : 0)));
  };

  // ===== comments actions (optimistic) =====
  const postComment = async () => {
    if (!isAuthenticated) return toast.error("Login required");
    const body = String(commentBody || "").trim();
    if (!body) return;

    setCommentSaving(true);

    const tempId = `tmp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      bet_id: Number(betId),
      user_id: Number(user?.id),
      username: user?.username || "you",
      parent_id: null,
      body,
      created_at: new Date().toISOString(),
      updated_at: null,
      like_count: 0,
      viewer_liked: false,
      reply_count: 0,
      replies: [],
      __optimistic: true,
    };

    setComments((prev) => [optimistic, ...(prev || [])]);
    setCommentBody("");

    try {
      const res = await customBetsAPI.addComment(betId, { body });
      const real = res.data?.data;

      setComments((prev) =>
        (prev || []).map((c) => (String(c.id) === String(tempId) ? { ...real, replies: [] } : c))
      );
    } catch (e) {
      setComments((prev) => (prev || []).filter((c) => String(c.id) !== String(tempId)));
      toast.error(e.response?.data?.message || "Failed to post");
    } finally {
      setCommentSaving(false);
      loadComments();
    }
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditingBody(c.body);
    setMenuOpenId(null);
  };

  const saveEdit = async () => {
    const body = String(editingBody || "").trim();
    if (!body) return toast.error("Comment required");

    const id = editingId;
    setCommentSaving(true);

    setComments((prev) =>
      updateCommentTree(
        prev,
        (x) => String(x.id) === String(id),
        (x) => ({ ...x, body })
      )
    );

    try {
      await customBetsAPI.editComment(id, { body });
      setEditingId(null);
      setEditingBody("");
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to edit");
      loadComments();
    } finally {
      setCommentSaving(false);
      loadComments();
    }
  };

  const delComment = async (id) => {
    setCommentSaving(true);

    const before = comments;
    setComments((prev) => removeFromCommentTree(prev, id));
    setMenuOpenId(null);

    try {
      await customBetsAPI.deleteComment(id);
    } catch (e) {
      setComments(before);
      toast.error(e.response?.data?.message || "Failed to delete");
    } finally {
      setCommentSaving(false);
      loadComments();
    }
  };

  const toggleLike = async (commentId) => {
    if (!isAuthenticated) return toast.error("Login required");

    setComments((prev) =>
      updateCommentTree(
        prev,
        (x) => String(x.id) === String(commentId),
        (x) => {
          const liked = !Boolean(x.viewer_liked);
          const cnt = Number(x.like_count || 0) + (liked ? 1 : -1);
          return { ...x, viewer_liked: liked, like_count: Math.max(0, cnt) };
        }
      )
    );

    try {
      const res = await customBetsAPI.toggleCommentLike(betId, commentId);
      const out = res.data?.data;
      setComments((prev) =>
        updateCommentTree(
          prev,
          (x) => String(x.id) === String(commentId),
          (x) => ({ ...x, like_count: out.like_count, viewer_liked: out.viewer_liked })
        )
      );
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to like");
      loadComments();
    }
  };

  const openReply = (commentId) => {
    if (!isAuthenticated) return toast.error("Login required");
    setReplyOpenFor(commentId);
    setReplyBody("");
    setCollapsed((set) => {
      const next = new Set(set);
      next.delete(String(commentId));
      return next;
    });
  };

  const sendReply = async (commentId) => {
    if (!isAuthenticated) return toast.error("Login required");
    const body = String(replyBody || "").trim();
    if (!body) return;

    setCommentSaving(true);

    const tempId = `tmp-r-${Date.now()}`;
    const optimisticReply = {
      id: tempId,
      bet_id: Number(betId),
      user_id: Number(user?.id),
      username: user?.username || "you",
      parent_id: Number(commentId),
      body,
      created_at: new Date().toISOString(),
      updated_at: null,
      like_count: 0,
      viewer_liked: false,
      reply_count: 0,
      replies: [],
      __optimistic: true,
    };

    setComments((prev) =>
      updateCommentTree(
        prev,
        (x) => String(x.id) === String(commentId),
        (x) => ({
          ...x,
          replies: [...(x.replies || []), optimisticReply],
          reply_count: Number(x.reply_count || x.replies?.length || 0) + 1,
        })
      )
    );

    setReplyOpenFor(null);
    setReplyBody("");

    try {
      const res = await customBetsAPI.replyToComment(betId, commentId, { body });
      const real = res.data?.data;

      setComments((prev) =>
        updateCommentTree(
          prev,
          (x) => String(x.id) === String(commentId),
          (x) => ({
            ...x,
            replies: (x.replies || []).map((r) => (String(r.id) === String(tempId) ? real : r)),
          })
        )
      );
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to reply");
      setComments((prev) =>
        updateCommentTree(
          prev,
          (x) => String(x.id) === String(commentId),
          (x) => ({
            ...x,
            replies: (x.replies || []).filter((r) => String(r.id) !== String(tempId)),
            reply_count: Math.max(0, Number(x.reply_count || 0) - 1),
          })
        )
      );
    } finally {
      setCommentSaving(false);
      loadComments();
    }
  };

  const toggleCollapse = (commentId) => {
    setCollapsed((set) => {
      const next = new Set(set);
      const k = String(commentId);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const doClose = async () => {
    setActionBusy(true);
    try {
      const res = await customBetsAPI.adminClose(betId);
      setMarket(res.data?.data);
      setCloseOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.message || "Close failed");
    } finally {
      setActionBusy(false);
    }
  };

  const doReopen = async () => {
    setActionBusy(true);
    try {
      const res = await customBetsAPI.adminReopen(betId);
      setMarket(res.data?.data);
      setCloseOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.message || "Reopen failed");
    } finally {
      setActionBusy(false);
    }
  };

  const doRemove = async () => {
    setActionBusy(true);
    try {
      await customBetsAPI.adminRemove(betId);
      setRemoveOpen(false);
      window.location.href = "/custom-bets#1";
    } catch (e) {
      toast.error(e.response?.data?.message || "Remove failed");
    } finally {
      setActionBusy(false);
    }
  };

  const doResolve = async () => {
    if (!resolveOptionId) return;
    setActionBusy(true);
    try {
      const res = await customBetsAPI.adminResolve(betId, { winningOptionId: resolveOptionId });
      setMarket(res.data?.data);
      setResolveOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.message || "Resolve failed");
    } finally {
      setActionBusy(false);
    }
  };

  const availableDays = useMemo(() => {
    const set = new Set();
    for (const p of graphPoints || []) {
      const k = dayKeyLocal(p.t);
      if (k) set.add(k);
    }
    return Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }, [graphPoints]);

  const last4Days = useMemo(() => availableDays.slice(-4), [availableDays]);

  const filteredGraphPointsBase = useMemo(() => {
    if (!selectedDayKey) return graphPoints || [];
    const start = new Date(`${selectedDayKey}T00:00:00`).getTime();
    const end = new Date(`${selectedDayKey}T23:59:59.999`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return graphPoints || [];
    return (graphPoints || []).filter((p) => {
      const t = new Date(p.t).getTime();
      return Number.isFinite(t) && t >= start && t <= end;
    });
  }, [graphPoints, selectedDayKey]);

  const filteredGraphPoints = useMemo(() => {
    const pts = filteredGraphPointsBase || [];
    if (pts.length >= 2) return pts;
    if (pts.length === 1) return [pts[0], { ...pts[0], t: pts[0].t }];
    return pts;
  }, [filteredGraphPointsBase]);

  const deltaPct = useMemo(() => {
    const pts = filteredGraphPoints || [];
    if (pts.length < 2) return 0;
    const a = Number(pts[0]?.v || 0);
    const b = Number(pts[pts.length - 1]?.v || 0);
    return Math.max(-100, Math.min(100, b - a));
  }, [filteredGraphPoints]);

  const displayChance = hoverChance == null ? selectedPct : hoverChance;
  const deltaUp = deltaPct >= 0;

  const selectedDayLabel = useMemo(
    () => (selectedDayKey ? dayLabelLongFromKey(selectedDayKey) : ""),
    [selectedDayKey]
  );

  const commentCount = useMemo(() => {
    const roots = comments || [];
    let n = roots.length;
    for (const c of roots) n += (c.replies?.length || 0);
    return n;
  }, [comments]);

  const renderMenu = (item, canModerate) => {
    if (!canModerate) return null;
    if (menuOpenId !== item.id) return null;

    const mine = Number(item.user_id) === Number(user?.id);

    return (
      <div className={styles.commentMenu} ref={menuWrapRef} role="menu">
        {mine && (
          <button className={styles.commentMenuItem} type="button" onClick={() => startEdit(item)}>
            Edit
          </button>
        )}
        <button
          className={`${styles.commentMenuItem} ${styles.commentMenuItemDanger}`}
          type="button"
          onClick={() => delComment(item.id)}
        >
          Delete
        </button>
      </div>
    );
  };

  const renderReply = (r) => {
    const mine = Number(r.user_id) === Number(user?.id);
    const canModerate = mine || isAdmin;
    const editing = editingId === r.id;

    return (
      <div key={r.id} className={styles.replyItem}>
        <div className={styles.commentRow}>
          <div className={styles.avatar} style={{ background: avatarColorFromName(r.username) }} aria-hidden="true" />
          <div className={styles.commentMain}>
            <div className={styles.commentHeaderLine}>
              <div className={styles.commentName}>@{r.username}</div>
              <span className={styles.commentTimeAgo}>{timeAgo(r.created_at)}</span>

              <div className={styles.commentMenuCell}>
                {canModerate && (
                  <button
                    className={styles.menuDotsBtn}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId((cur) => (String(cur) === String(r.id) ? null : r.id));
                    }}
                    aria-label="Comment menu"
                  >
                    <DotsIcon />
                  </button>
                )}
                {renderMenu(r, canModerate)}
              </div>
            </div>

            {!editing ? (
              <div className={styles.commentText}>{r.body}</div>
            ) : (
              <div className={styles.editRow}>
                <input className={styles.commentInput} value={editingBody} onChange={(e) => setEditingBody(e.target.value)} />
                <button className={styles.postBtn} onClick={saveEdit} disabled={commentSaving} type="button">
                  Save
                </button>
                <button
                  className={styles.smallBtn}
                  onClick={() => {
                    setEditingId(null);
                    setEditingBody("");
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            )}

            <div className={styles.commentActions}>
              <div className={styles.commentActionsLeft}>
                <button
                  className={`${styles.iconBtn} ${r.viewer_liked ? styles.likeActive : ""}`}
                  type="button"
                  onClick={() => toggleLike(r.id)}
                  disabled={commentSaving}
                  aria-label="Like"
                >
                  {r.viewer_liked ? <HeartFilledIcon /> : <HeartOutlineIcon />}
                  <span className={styles.iconCount}>{Number(r.like_count || 0)}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderComment = (c) => {
    const mine = Number(c.user_id) === Number(user?.id);
    const canModerate = mine || isAdmin;
    const editing = editingId === c.id;

    const replies = Array.isArray(c.replies) ? c.replies : [];
    const replyCount = Number(c.reply_count || replies.length || 0);
    const isCollapsed = collapsed.has(String(c.id));

    return (
      <div key={c.id} className={styles.comment}>
        <div className={styles.commentRow}>
          <div className={styles.avatar} style={{ background: avatarColorFromName(c.username) }} aria-hidden="true" />

          <div className={styles.commentMain}>
            <div className={styles.commentHeaderLine}>
              <div className={styles.commentName}>@{c.username}</div>
              <span className={styles.badgePill}>{badgeTextFromDate(c.created_at)}</span>
              <span className={styles.commentTimeAgo}>{timeAgo(c.created_at)}</span>

              <div className={styles.commentMenuCell}>
                {canModerate && (
                  <button
                    className={styles.menuDotsBtn}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId((cur) => (String(cur) === String(c.id) ? null : c.id));
                    }}
                    aria-label="Comment menu"
                  >
                    <DotsIcon />
                  </button>
                )}
                {renderMenu(c, canModerate)}
              </div>
            </div>

            {!editing ? (
              <div className={styles.commentText}>{c.body}</div>
            ) : (
              <div className={styles.editRow}>
                <input className={styles.commentInput} value={editingBody} onChange={(e) => setEditingBody(e.target.value)} />
                <button className={styles.postBtn} onClick={saveEdit} disabled={commentSaving} type="button">
                  Save
                </button>
                <button
                  className={styles.smallBtn}
                  onClick={() => {
                    setEditingId(null);
                    setEditingBody("");
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            )}

            <div className={styles.commentActions}>
              <div className={styles.commentActionsLeft}>
                <button
                  className={`${styles.iconBtn} ${c.viewer_liked ? styles.likeActive : ""}`}
                  type="button"
                  onClick={() => toggleLike(c.id)}
                  disabled={commentSaving}
                  aria-label="Like"
                >
                  {c.viewer_liked ? <HeartFilledIcon /> : <HeartOutlineIcon />}
                  <span className={styles.iconCount}>{Number(c.like_count || 0)}</span>
                </button>

                <button
                  className={styles.iconBtn}
                  type="button"
                  onClick={() => openReply(c.id)}
                  disabled={commentSaving}
                  aria-label="Reply"
                >
                  <ReplyIcon />
                  <span className={styles.replyLabel}>Reply</span>
                </button>
              </div>
            </div>

            {replyOpenFor === c.id && (
              <div className={styles.replyComposer}>
                <input
                  className={styles.commentInput}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write a reply..."
                />
                <button className={styles.postBtn} onClick={() => sendReply(c.id)} disabled={!isAuthenticated || commentSaving} type="button">
                  Reply
                </button>
                <button
                  className={styles.smallBtn}
                  type="button"
                  onClick={() => {
                    setReplyOpenFor(null);
                    setReplyBody("");
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {replyCount > 0 && (
              <button type="button" className={styles.repliesToggle} onClick={() => toggleCollapse(c.id)}>
                {replyCount} {replyCount === 1 ? "Reply" : "Replies"}{" "}
                <span className={styles.repliesChevron} style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(180deg)" }}>
                  ^
                </span>
              </button>
            )}

            {replyCount > 0 && !isCollapsed && (
              <div className={styles.repliesWrap}>
                {replies.map(renderReply)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const commentsPanel = (
    <div className={styles.commentsPm}>
      <div className={styles.commentsTabs}>
        <button className={`${styles.commentsTab} ${styles.commentsTabActive}`} type="button">
          Comments <span className={styles.commentsCount}>({commentCount.toLocaleString()})</span>
        </button>
        <button className={styles.commentsTab} type="button" disabled>
          Top Holders
        </button>
        <button className={styles.commentsTab} type="button" disabled>
          Positions
        </button>
        <button className={styles.commentsTab} type="button" disabled>
          Activity
        </button>
      </div>

      <div className={styles.commentsComposerRow}>
        <input
          className={styles.commentsComposerInput}
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          placeholder={isAuthenticated ? "Add a comment..." : "Login to comment..."}
          disabled={!isAuthenticated}
        />
        <button className={styles.commentsComposerPost} onClick={postComment} disabled={!isAuthenticated || commentSaving} type="button">
          Post
        </button>
      </div>

      <div className={styles.commentsToolsRow}>
        <div className={styles.sortWrap}>
          <button
            className={styles.sortBtn}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSortOpen((s) => !s);
            }}
          >
            Newest <span className={styles.sortCaret}>▾</span>
          </button>

          {sortOpen && (
            <div className={styles.sortMenu} role="menu">
              <button className={styles.sortMenuItem} type="button" onClick={() => setSortOpen(false)}>
                Newest
              </button>
              <button className={styles.sortMenuItem} type="button" onClick={() => setSortOpen(false)}>
                Oldest
              </button>
            </div>
          )}
        </div>

        <label className={styles.holdersToggle}>
          <input type="checkbox" checked={holdersOnly} onChange={(e) => setHoldersOnly(e.target.checked)} />
          <span>Holders</span>
        </label>

        <div className={styles.toolsSpacer} />

        <div className={styles.warningPill}>
          <ShieldIcon />
          Beware of external links.
        </div>
      </div>

      {commentsLoading ? (
        <div className={styles.muted}>Loading comments…</div>
      ) : (
        <div className={styles.commentListPm}>{comments.map(renderComment)}</div>
      )}

      {!commentsLoading && comments.length === 0 && <div className={styles.muted}>No comments yet.</div>}
    </div>
  );

  // ===== rest of UI =====
  const optionCount = options.length;
  const useTwoPills = optionCount === 2;
  const optionA = useTwoPills ? options[0] : null;
  const optionB = useTwoPills ? options[1] : null;

  const aCents = useTwoPills ? clampCentsFromPct(Number(percents[0] || 0)) : null;
  const bCents = useTwoPills ? clampCentsFromPct(Number(percents[1] || 0)) : null;

  const selectedIsA = useTwoPills && optionA && Number(selectedOptionId) === Number(optionA.id);
  const selectedIsB = useTwoPills && optionB && Number(selectedOptionId) === Number(optionB.id);

  return (
    <div className={styles.page}>
      <DepositToastStack toasts={depositToasts} onRemove={(id) => setDepositToasts((prev) => prev.filter((t) => t.id !== id))} />

      {/* overlay header */}
      <div className={`${styles.floatHeader} ${floatOn ? styles.floatHeaderOn : ""}`}>
        <div className={styles.floatInner}>
          {market?.image_url ? <img className={styles.floatAvatar} src={market.image_url} alt="" /> : <div className={styles.floatAvatarFallback} />}
          <div className={styles.floatTitle}>{loading ? "Loading…" : market?.title || "Market"}</div>
          <div className={styles.floatActions}>
            <button className={styles.floatIconBtn} type="button" title="Share" aria-label="Share">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7" /><path d="M7 7h10v10" />
              </svg>
            </button>
            <button className={styles.floatIconBtn} type="button" title="Bookmark" aria-label="Bookmark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className={styles.shell}>
        <div className={styles.noteBox}>
          <b>Note on Markets:</b> Virtual credits only.
        </div>

        <div className={styles.layout}>
          <div className={styles.left}>
            <div className={styles.header}>
              {market?.image_url ? <img className={styles.flagImg} src={market.image_url} alt="" /> : <div className={styles.flagIcon} />}
              <div className={styles.headText}>
                <div className={styles.breadcrumb}>Custom Bets</div>
                <div className={styles.titleRow}>
                  <h1 className={styles.title}>{loading ? "Loading…" : market?.title || "Market"}</h1>
                </div>

                <div className={styles.metaRow}>
                  <div className={styles.metaLeft}>
                    <span className={styles.vol}>
                      ${Number(market?.pool_total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} Vol.
                    </span>
                    <span className={styles.dot}>•</span>
                    <span className={styles.ends}>{market?.end_at ? `Ends ${fmtEndsMeta(market.end_at)}` : ""}</span>
                    <span className={styles.mobileEndsBadge}>{market?.end_at ? `• ${fmtEndsBadge(market.end_at)}` : ""}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Graph section */}
            <div className={styles.pmGraphSection}>
              <div className={styles.pmTopRow}>
                <div className={styles.pmPillsRow}>
                  <div className={styles.pastWrap} ref={pastWrapRef}>
                    <button className={styles.pmPastBtn} type="button" onClick={() => setPastOpen((s) => !s)} disabled={!availableDays.length} aria-expanded={pastOpen} aria-haspopup="menu">
                      Past
                      <span className={`${styles.pmCaretIcon} ${pastOpen ? styles.pmCaretIconOpen : ""}`} aria-hidden="true">
                        <PastCaretIcon />
                      </span>
                    </button>

                    {pastOpen && (
                      <div className={styles.menuSurface} role="menu" aria-label="Past dates">
                        <button
                          className={`${styles.menuItem} ${selectedDayKey == null ? styles.menuItemActive : ""}`}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSelectedDayKey(null);
                            setPastOpen(false);
                          }}
                        >
                          <span className={styles.menuItemIcon} aria-hidden="true"><MenuItemIcon /></span>
                          <span className={styles.menuItemLabel}>All available</span>
                        </button>

                        {availableDays.slice().reverse().map((k) => (
                          <button
                            key={k}
                            className={`${styles.menuItem} ${selectedDayKey === k ? styles.menuItemActive : ""}`}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setSelectedDayKey(k);
                              setPastOpen(false);
                            }}
                          >
                            <span className={styles.menuItemIcon} aria-hidden="true"><MenuItemIcon /></span>
                            <span className={styles.menuItemLabel}>{dayLabelFromKey(k)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {last4Days.map((k) => (
                    <button key={k} className={`${styles.pmDayPill} ${selectedDayKey === k ? styles.pmDayPillActive : ""}`} type="button" onClick={() => setSelectedDayKey((cur) => (cur === k ? null : k))}>
                      {dayLabelFromKey(k)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.pmChanceRow}>
                <div className={styles.pmChanceValue}>
                  <SlotRollingNumber value={displayChance} format={(n) => `${Math.round(n)}% chance`} durationMs={420} />
                </div>

                <div className={`${styles.pmDeltaExact} ${deltaUp ? styles.pmDeltaUp : styles.pmDeltaDown}`}>
                  <span className={styles.pmArrowSvgWrap} aria-hidden="true">
                    {deltaUp ? (
                      <svg className={styles.pmArrowSvg} viewBox="-4 -2 15 15">
                        <path d="m7.248,2.52c-.559-.837-1.938-.837-2.496,0L1.653,7.168c-.308.461-.336,1.051-.074,1.54.262.489.769.792,1.322.792h6.197c.554,0,1.061-.303,1.322-.792.262-.488.233-1.079-.074-1.54l-3.099-4.648Z" strokeWidth="0" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg className={styles.pmArrowSvg} viewBox="-4 -2 15 15">
                        <path d="m9.099,2.5H2.901c-.554,0-1.061.303-1.322.792-.262.488-.233,1.079.074,1.54l3.099,4.648c.279.418.745.668,1.248.668s.969-.25,1.248-.668l3.099-4.648c.308-.461.336-1.051.074-1.54-.262-.489-.769-.792-1.322-.792Z" strokeWidth="0" fill="currentColor" />
                      </svg>
                    )}
                  </span>

                  <SlotRollingNumber value={Math.abs(deltaPct)} format={(n) => `${Math.round(Number(n) || 0)}%`} durationMs={420} />
                </div>
              </div>

              <div className={styles.pmChartWrap}>
                {graphLoading ? (
                  <div className={styles.pmChartLoading}>Loading…</div>
                ) : (
                  <ChanceGraph
                    points={filteredGraphPoints}
                    height={320}
                    activeLabel={selectedOption?.label || ""}
                    redrawKey={graphRedrawNonce}
                    morphKey={graphMorphNonce}
                    onHoverPoint={(p) => {
                      if (!p) return setHoverChance(null);
                      setHoverChance(Number(p.v) || 0);
                    }}
                  />
                )}
              </div>

              <div className={styles.pmBottomRow}>
                <div className={styles.pmBottomLeft}>
                  <span className={styles.pmBottomVol}>
                    ${Number(market?.pool_total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} Vol.
                  </span>
                  <span className={styles.pmBottomSep}>|</span>
                  <span className={styles.pmBottomDate}>{selectedDayLabel || ""}</span>
                </div>

                <div className={styles.pmBottomRight}>
                  <div className={styles.pmTimeframes}>
                    {[
                      { k: "5m", bucket: 1 },
                      { k: "15m", bucket: 3 },
                      { k: "1h", bucket: 10 },
                      { k: "3h", bucket: 30 },
                      { k: "6h", bucket: 60 },
                      { k: "1d", bucket: 180 },
                    ].map((b) => (
                      <button key={b.k} className={`${styles.pmTfBtn} ${bucketMinutes === b.bucket ? styles.pmTfActive : ""}`} type="button" onClick={() => setBucketMinutes(b.bucket)}>
                        {b.k}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* options table */}
            <div className={styles.table}>
              {(market?.options || []).map((o, idx) => {
                const pct = Number(percents[idx] || 0);
                const yesCents = clampCentsFromPct(pct);
                const disabled = !isOpen;

                return (
                  <div key={o.id} className={styles.row}>
                    <div className={styles.rowLeft}>
                      <div className={styles.rowDate}>{o.label}</div>
                      <div className={styles.rowVol}>
                        ${Number(o.total || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} Vol.
                      </div>
                    </div>

                    <div className={styles.rowMid}>
                      <SlotRollingNumber value={pct} format={(n) => `${Math.round(n)}%`} durationMs={380} />
                    </div>

                    <div className={styles.rowRight}>
                      <button className={styles.buyYesBtn} onClick={() => selectOptionFn(o.id)} type="button" disabled={disabled}>
                        Buy Yes {yesCents}¢
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.commentsWrap}>{commentsPanel}</div>
          </div>

          {/* Sidebar */}
          <div className={styles.right}>
            <div className={styles.buyCard}>
              <div className={styles.sidebarHeader}>
                {market?.image_url ? <img className={styles.sidebarHeaderImg} src={market.image_url} alt="" /> : <div className={styles.sidebarHeaderImgFallback} />}
                <div className={styles.sidebarHeaderDate}>{market?.end_at ? fmtEndsBadge(market.end_at) : ""}</div>
              </div>

              <div className={styles.sidebarTopRow}>
                <div className={styles.tabs}>
                  <div className={styles.tabActive}>Buy</div>
                  <div className={styles.tabDisabled}>Sell</div>
                </div>

                <div className={styles.optionsMenuWrap} ref={optionsWrapRef}>
                  <button
                    className={styles.optionsMenuBtn}
                    type="button"
                    onClick={() => setOptionsOpen((s) => !s)}
                    disabled={!isOpen || !options.length}
                    aria-expanded={optionsOpen}
                    aria-haspopup="menu"
                    title={selectedOption?.label || ""}
                  >
                    <span className={styles.optionsMenuBtnText}>{selectedOption?.label || "Market"}</span>
                    <span className={`${styles.pmCaretIcon} ${optionsOpen ? styles.pmCaretIconOpen : ""}`} aria-hidden="true">
                      <PastCaretIcon />
                    </span>
                  </button>

                  {optionsOpen && (
                    <div className={`${styles.menuSurface} ${styles.optionsMenuSurface}`} role="menu" aria-label="Options">
                      {options.map((o, idx) => {
                        const cents = clampCentsFromPct(Number(percents[idx] || 0));
                        const active = Number(o.id) === Number(selectedOptionId);

                        return (
                          <button
                            key={o.id}
                            className={`${styles.menuItem} ${active ? styles.menuItemActive : ""}`}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              selectOptionFn(o.id, { openSheetOnMobile: false });
                              setOptionsOpen(false);
                            }}
                            title={o.label}
                          >
                            <span className={styles.menuItemIcon} aria-hidden="true"><MenuItemIcon /></span>
                            <span className={styles.menuItemLabel}>{o.label} • {cents}¢</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.buyCardBody}>
                {useTwoPills && (
                  <div className={styles.selectRow}>
                    <div className={styles.twoPills}>
                      <button
                        className={[styles.pillBtn, selectedIsA ? styles.pillGreen : styles.pillOff].join(" ")}
                        type="button"
                        disabled={!isOpen || !optionA}
                        onClick={() => optionA && selectOptionFn(optionA.id, { openSheetOnMobile: false })}
                        title={optionA?.label || ""}
                      >
                        {optionA?.label || "—"} {aCents}¢
                      </button>

                      <button
                        className={[styles.pillBtn, selectedIsB ? styles.pillRed : styles.pillOff].join(" ")}
                        type="button"
                        disabled={!isOpen || !optionB}
                        onClick={() => optionB && selectOptionFn(optionB.id, { openSheetOnMobile: false })}
                        title={optionB?.label || ""}
                      >
                        {optionB?.label || "—"} {bCents}¢
                      </button>
                    </div>
                  </div>
                )}

                <div className={styles.amountBox}>
                  <div className={styles.amountHeader}>
                    <div>
                      <div className={styles.amountLabel}>Amount</div>
                      <div className={styles.balanceLine}>Balance ${Number(user?.balance ?? 0).toFixed(2)}</div>
                    </div>

                    <div className={styles.bigAmountWrap}>
                      <input
                        className={`${styles.bigAmountInput} ${isTypingAmount ? styles.bigAmountInputTyping : ""}`}
                        value={amountStr.startsWith("$") ? amountStr : `$${amountStr}`}
                        onFocus={() => {
                          if (String(amountStr) === "0") setAmountStr("");
                        }}
                        onBlur={() => {
                          if (String(amountStr || "").trim() === "") setAmountStr("0");
                        }}
                        onChange={(e) => {
                          const raw = e.target.value.replace("$", "");
                          let cleaned = raw.replace(/[^\d.]/g, "");
                          if (cleaned.length > 1 && cleaned[0] === "0" && cleaned[1] !== ".") {
                            cleaned = cleaned.replace(/^0+/, "");
                            if (cleaned === "") cleaned = "0";
                          }
                          setAmountStr(cleaned);
                        }}
                        inputMode="decimal"
                        placeholder="$0"
                      />
                    </div>
                  </div>

                  <div className={styles.quickRow}>
                    <button onClick={() => quickAdd(1)} type="button">+$1</button>
                    <button onClick={() => quickAdd(5)} type="button">+$5</button>
                    <button onClick={() => quickAdd(10)} type="button">+$10</button>
                    <button onClick={() => quickAdd(100)} type="button">+$100</button>
                    <button onClick={setMax} type="button">Max</button>
                  </div>
                </div>

                <div className={`${styles.toWinAnimWrap} ${amount > 0 ? styles.toWinAnimWrapOpen : ""}`}>
                  <div className={styles.toWin}>
                    <div className={styles.toWinLeft}>
                      <div className={styles.toWinLabel}>To win</div>
                      <div className={styles.avgPrice}>
                        Avg. Price <span className={styles.avgPriceVal}>{avgPriceCents == null ? "—" : `${Math.round(avgPriceCents)}¢`}</span>
                        <span className={styles.infoDot} title="Implied average price from pool weights">i</span>
                      </div>
                    </div>

                    <div className={styles.toWinValue}>
                      <SlotRollingNumber value={toWin} format={(n) => `$${Number(n || 0).toFixed(2)}`} durationMs={460} />
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.buyCardFooter}>
                <div className={styles.deposit3dWrap}>
                  <button className={`${styles.deposit3d} ${buying ? styles.depositLoading : ""}`} onClick={buy} disabled={!canBuy} type="button">
                    {isRemoved ? "Removed" : isResolved ? "Resolved" : status === "closed" || ended ? "Closed" : buying ? "Depositing..." : "Deposit"}
                  </button>
                  <div className={styles.depositBase} />
                </div>

                {isAdmin && (
                  <div className={styles.adminBar}>
                    <button className={styles.adminBtn} type="button" onClick={() => setCloseOpen(true)} disabled={actionBusy || isRemoved || isResolved || (ended && status === "closed")}>
                      {closeLabel}
                    </button>
                    <button className={styles.adminBtn} type="button" onClick={() => setResolveOpen(true)} disabled={actionBusy || isRemoved || isResolved}>
                      Resolve
                    </button>
                    <button className={styles.adminDanger} type="button" onClick={() => setRemoveOpen(true)} disabled={actionBusy || isRemoved || isResolved}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Back to top */}
      <button className={`${styles.backTop} ${showBackTop ? styles.backTopOn : ""}`} type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">
        <span className={styles.backTopArrow}>↑</span>
        Back to top
      </button>

      {/* MOBILE ONLY: Slide-in Detail Panel (Screen 2) */}
      {isMobile && (
        <>
          <div className={`${styles.mDetailBackdrop} ${mobileDetailOpen ? styles.mDetailBackdropOpen : ""}`} onClick={() => setMobileDetailOpen(false)} />
          <div className={`${styles.mDetailPanel} ${mobileDetailOpen ? styles.mDetailPanelOpen : ""}`}>
            <div className={styles.mDetailTopBar}>
              <button className={styles.mDetailBack} type="button" onClick={() => setMobileDetailOpen(false)} aria-label="Back">‹</button>
              <div className={styles.mDetailTopActions}>
                <button className={styles.mDetailTopBtn} type="button" aria-label="Code">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                  </svg>
                </button>
                <button className={styles.mDetailTopBtn} type="button" aria-label="Bookmark">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <button className={styles.mDetailTopBtn} type="button" aria-label="Share">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7" /><path d="M7 7h10v10" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={styles.mDetailBody}>
              <div className={styles.mDetailHeader}>
                {market?.image_url ? <img className={styles.mDetailImg} src={market.image_url} alt="" /> : <div className={styles.mDetailImgFallback} />}
                <div className={styles.mDetailLabel}>{selectedOption?.label || "—"}</div>
              </div>

              <div className={styles.mDetailChance}>
                <div className={styles.mDetailChanceVal}>
                  <SlotRollingNumber value={displayChance} format={(n) => `${Math.round(n)}% chance`} durationMs={420} />
                </div>
                <div className={`${styles.pmDeltaExact} ${deltaUp ? styles.pmDeltaUp : styles.pmDeltaDown}`}>
                  <span className={styles.pmArrowSvgWrap} aria-hidden="true">
                    {deltaUp ? (
                      <svg className={styles.pmArrowSvg} viewBox="-4 -2 15 15">
                        <path d="m7.248,2.52c-.559-.837-1.938-.837-2.496,0L1.653,7.168c-.308.461-.336,1.051-.074,1.54.262.489.769.792,1.322.792h6.197c.554,0,1.061-.303,1.322-.792.262-.488.233-1.079-.074-1.54l-3.099-4.648Z" strokeWidth="0" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg className={styles.pmArrowSvg} viewBox="-4 -2 15 15">
                        <path d="m9.099,2.5H2.901c-.554,0-1.061.303-1.322.792-.262.488-.233,1.079.074,1.54l3.099,4.648c.279.418.745.668,1.248.668s.969-.25,1.248-.668l3.099-4.648c.308-.461.336-1.051.074-1.54-.262-.489-.769-.792-1.322-.792Z" strokeWidth="0" fill="currentColor" />
                      </svg>
                    )}
                  </span>
                  <SlotRollingNumber value={Math.abs(deltaPct)} format={(n) => `${Math.round(Number(n) || 0)}%`} durationMs={420} />
                </div>
              </div>

              <div className={styles.mDetailGraphWrap}>
                {graphLoading ? (
                  <div className={styles.pmChartLoading}>Loading…</div>
                ) : (
                  <ChanceGraph
                    points={filteredGraphPoints}
                    height={240}
                    activeLabel={selectedOption?.label || ""}
                    redrawKey={graphRedrawNonce}
                    morphKey={graphMorphNonce}
                    onHoverPoint={(p) => {
                      if (!p) return setHoverChance(null);
                      setHoverChance(Number(p.v) || 0);
                    }}
                  />
                )}
              </div>

              <div className={styles.mDetailVolRow}>
                <div className={styles.mDetailVolText}>
                  ${Number(market?.pool_total ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} Vol.
                </div>
                <div className={styles.mDetailTfs}>
                  {[
                    { k: "1H", bucket: 10 },
                    { k: "1D", bucket: 60 },
                    { k: "1W", bucket: 180 },
                    { k: "1M", bucket: 720 },
                    { k: "MAX", bucket: 1440 },
                  ].map((b) => (
                    <button key={b.k} className={`${styles.mDetailTfBtn} ${bucketMinutes === b.bucket ? styles.mDetailTfActive : ""}`} type="button" onClick={() => setBucketMinutes(b.bucket)}>
                      {b.k}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.mDetailCommentsWrap}>{commentsPanel}</div>
            </div>

            <div className={styles.mDetailDock}>
              <div className={styles.mDetail3dWrap}>
                <button className={styles.mDetail3dBtn} type="button" disabled={!isOpen} onClick={() => setSheetOpen(true)}>
                  Buy Yes {selectCents}¢
                </button>
                <div className={styles.mDetail3dBase} />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Close/Reopen modal */}
      {closeOpen && (
        <div className={styles.modalBackdrop} onClick={() => setCloseOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>
              {canReopen ? "Reopen Market" : ended && status === "closed" ? "Market Ended" : "Close Market"}
            </div>
            <div className={styles.modalSub}>
              {canReopen
                ? "Reopen will allow deposits again until the end time."
                : ended && status === "closed"
                  ? "This market already ended and cannot be reopened."
                  : "Closing stops deposits immediately (market stays visible)."}
            </div>

            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setCloseOpen(false)} type="button">
                Cancel
              </button>
              <button className={styles.primaryBtn} onClick={canReopen ? doReopen : doClose} disabled={actionBusy || (ended && status === "closed")} type="button">
                {canReopen ? "Reopen" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove modal */}
      {removeOpen && (
        <div className={styles.modalBackdrop} onClick={() => setRemoveOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Remove Market</div>
            <div className={styles.modalSub}>This will remove the market and refund all pending deposits.</div>

            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setRemoveOpen(false)} type="button">
                Cancel
              </button>
              <button className={styles.dangerBtn} onClick={doRemove} disabled={actionBusy || isResolved} type="button">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {resolveOpen && (
        <div className={styles.modalBackdrop} onClick={() => setResolveOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalTitle}>Resolve Market</div>
            <div className={styles.modalSub}>Pick the winning option.</div>

            <select className={styles.modalSelect} value={resolveOptionId || ""} onChange={(e) => setResolveOptionId(Number(e.target.value))}>
              {(market?.options || []).map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>

            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={() => setResolveOpen(false)} type="button">
                Cancel
              </button>
              <button className={styles.primaryBtn} onClick={doResolve} disabled={actionBusy} type="button">
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile buy sheet - ONLY render on mobile */}
      {isMobile && (
        <MobileSheet open={sheetOpen} title="" onClose={() => setSheetOpen(false)}>
          <div style={{ padding: "0 2px" }}>
            <div className={styles.mSheetHeader}>
              <div className={styles.mSheetBuyLabel}>Buy ▾</div>
              <div className={styles.mSheetMarketLabel}>Market</div>
            </div>

            <div className={styles.mSheetInfo}>
              {market?.image_url ? <img className={styles.mSheetInfoImg} src={market.image_url} alt="" /> : <div className={styles.mSheetInfoImgFallback} />}
              <div className={styles.mSheetInfoText}>
                <div className={styles.mSheetInfoTitle}>{market?.title || "Market"}</div>
                <div className={styles.mSheetInfoMeta}>
                  {selectedOption?.label || ""}
                  <span className={styles.mSheetYesBadge}>Yes</span>
                </div>
              </div>
              <div className={styles.mSheetBal}>Bal. ${Number(user?.balance ?? 0).toFixed(2)}</div>
            </div>

            <div className={styles.mSheetAmountWrap}>
              <button
                className={styles.mSheetAmountBtn}
                type="button"
                onClick={() => {
                  const cur = Number(String(amountStr).replace(/[^\d.]/g, "") || 0);
                  if (cur > 0) setAmountStr(String(Math.max(0, cur - 1)));
                }}
              >
                −
              </button>

              <input
                className={`${styles.mSheetAmountInput} ${isTypingAmount ? styles.mSheetAmountInputTyping : ""}`}
                value={amountStr.startsWith("$") ? amountStr : `$${amountStr}`}
                onFocus={() => {
                  if (String(amountStr) === "0") setAmountStr("");
                }}
                onBlur={() => {
                  if (String(amountStr || "").trim() === "") setAmountStr("0");
                }}
                onChange={(e) => {
                  const raw = e.target.value.replace("$", "");
                  let cleaned = raw.replace(/[^\d.]/g, "");
                  if (cleaned.length > 1 && cleaned[0] === "0" && cleaned[1] !== ".") {
                    cleaned = cleaned.replace(/^0+/, "");
                    if (cleaned === "") cleaned = "0";
                  }
                  setAmountStr(cleaned);
                }}
                inputMode="decimal"
                placeholder="$0"
              />

              <button className={styles.mSheetAmountBtn} type="button" onClick={() => quickAdd(1)}>
                +
              </button>
            </div>

            <div className={styles.mSheetQuickRow}>
              <button onClick={() => quickAdd(1)} type="button">+$1</button>
              <button onClick={() => quickAdd(5)} type="button">+$5</button>
              <button onClick={() => quickAdd(10)} type="button">+$10</button>
              <button onClick={() => quickAdd(100)} type="button">+$100</button>
              <button onClick={setMax} type="button">Max</button>
            </div>

            <div className={styles.mSheetDepositWrap}>
              <button className={styles.mSheetDepositBtn} onClick={buy} disabled={!canBuy} type="button">
                {buying ? "Depositing..." : "Deposit"}
              </button>
            </div>
          </div>
        </MobileSheet>
      )}
    </div>
  );
}