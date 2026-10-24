import { useEffect, useState } from "react";
import { Check, Search, UserMinus, UserPlus, Users, X } from "lucide-react";
import { loadFriends, lookupFriend, removeFriend, respondFriendRequest, sendFriendRequest } from "./supabase.js";
import { getErrorMessage } from "./errorMessage.js";

function Person({ person }) {
  return <span className="friend-avatar">{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : person.name.slice(0, 1).toLocaleUpperCase("ru")}</span>;
}

export default function Friends({ userId }) {
  const [friends, setFriends] = useState([]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const incoming = friends.filter((friend) => friend.status === "pending" && friend.direction === "incoming");
  const outgoing = friends.filter((friend) => friend.status === "pending" && friend.direction === "outgoing");
  const accepted = friends.filter((friend) => friend.status === "accepted");

  useEffect(() => {
    let active = true;
    loadFriends().then((items) => { if (active) { setFriends(items); setError(""); } })
      .catch((loadError) => { if (active) setError(getErrorMessage(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  async function refresh() {
    setLoading(true);
    try { setFriends(await loadFriends()); setError(""); }
    catch (loadError) { setError(getErrorMessage(loadError)); }
    finally { setLoading(false); }
  }

  async function search(event) {
    event.preventDefault();
    setError(""); setNotice(""); setMatches([]);
    if (query.trim().length < 3) { setError("Введите точное имя или email (не менее 3 символов)."); return; }
    setBusy("search");
    try {
      const result = await lookupFriend(query);
      const linkedIds = new Set(friends.map((friend) => friend.userId));
      setMatches(result.filter((person) => !linkedIds.has(person.userId)));
      if (!result.length) setNotice("Пользователь с таким точным именем или email не найден.");
      else if (result.every((person) => linkedIds.has(person.userId))) setNotice("Запрос или дружба с этим пользователем уже есть.");
    } catch (searchError) { setError(getErrorMessage(searchError)); }
    finally { setBusy(""); }
  }

  async function act(key, action, message) {
    setBusy(key); setError(""); setNotice("");
    try { await action(); await refresh(); setNotice(message); setMatches([]); }
    catch (actionError) { setError(getErrorMessage(actionError)); }
    finally { setBusy(""); }
  }

  return <section className="friends-area">
    {error && <p className="sync-alert" role="alert">{error}</p>}
    {notice && <p className="sync-notice" role="status">{notice}</p>}
    <section className="panel friends-panel">
      <div className="section-heading"><div><span className="section-kicker">Общайтесь и планируйте вместе</span><h2>Друзья</h2></div><span className="workspace-card-icon"><Users size={17} /></span></div>
      <p className="friends-privacy">Поиск доступен только по точному имени или email. Друг не получает доступ к вашим задачам и рабочим пространствам.</p>
      <form className="friend-search-form" onSubmit={search}>
        <label className="field"><span>Найти пользователя</span><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength="320" placeholder="Точное имя или email" /></label>
        <button className="button button-primary" type="submit" disabled={Boolean(busy) || query.trim().length < 3}><Search size={15} />{busy === "search" ? "Ищем…" : "Найти"}</button>
      </form>
      {matches.map((person) => <article className="friend-row" key={person.userId}><Person person={person} /><div className="friend-copy"><strong>{person.name}</strong><small>Пользователь Dayflow</small></div><button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => act(`send-${person.userId}`, () => sendFriendRequest(person.userId), "Запрос отправлен.")}><UserPlus size={15} /> Добавить</button></article>)}
    </section>

    <section className="panel friends-panel">
      <div className="section-heading"><div><span className="section-kicker">Ответьте на приглашение</span><h2>Входящие запросы</h2></div>{incoming.length > 0 && <span className="section-tab-badge">{incoming.length}</span>}</div>
      {incoming.length ? incoming.map((friend) => <article className="friend-row" key={friend.friendshipId}><Person person={friend} /><div className="friend-copy"><strong>{friend.name}</strong><small>Запрос в друзья · {new Date(friend.createdAt).toLocaleDateString("ru-RU")}</small></div><div className="friend-row-actions"><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => act(`accept-${friend.friendshipId}`, () => respondFriendRequest(friend.friendshipId, true), "Теперь вы друзья.")}><Check size={14} /> Принять</button><button className="button button-quiet" type="button" disabled={Boolean(busy)} onClick={() => act(`decline-${friend.friendshipId}`, () => respondFriendRequest(friend.friendshipId, false), "Запрос отклонён.")}><X size={14} /> Отклонить</button></div></article>) : <p className="workspace-hint">{loading ? "Загружаем запросы…" : "Входящих запросов пока нет."}</p>}
    </section>

    <section className="panel friends-panel">
      <div className="section-heading"><div><span className="section-kicker">Уже отправлены</span><h2>Исходящие запросы</h2></div></div>
      {outgoing.length ? outgoing.map((friend) => <article className="friend-row" key={friend.friendshipId}><Person person={friend} /><div className="friend-copy"><strong>{friend.name}</strong><small>Ожидает ответа</small></div><button className="button button-quiet" type="button" disabled={Boolean(busy)} onClick={() => act(`cancel-${friend.friendshipId}`, () => removeFriend(friend.friendshipId), "Запрос отменён.")}><X size={14} /> Отменить</button></article>) : <p className="workspace-hint">Исходящих запросов нет.</p>}
    </section>

    <section className="panel friends-panel">
      <div className="section-heading"><div><span className="section-kicker">Ваш круг общения</span><h2>Мои друзья <small className="friends-count">{accepted.length}</small></h2></div></div>
      {accepted.length ? accepted.map((friend) => <article className="friend-row" key={friend.friendshipId}><Person person={friend} /><div className="friend-copy"><strong>{friend.name}</strong><small>В друзьях с {new Date(friend.createdAt).toLocaleDateString("ru-RU")}</small></div><button className="icon-button danger-hover" type="button" aria-label={`Удалить ${friend.name} из друзей`} title="Удалить из друзей" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Удалить ${friend.name} из друзей?`)) act(`remove-${friend.friendshipId}`, () => removeFriend(friend.friendshipId), "Пользователь удалён из друзей."); }}><UserMinus size={16} /></button></article>) : <p className="workspace-hint">Друзей пока нет. Найдите пользователя по точному имени или email.</p>}
    </section>
  </section>;
}
