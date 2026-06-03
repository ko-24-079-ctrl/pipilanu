const SUPABASE_URL = 'https://mdrqycekifhadzrimofk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_8-0_dJ813GI7jcku3JmnLw_-l-Wm7cd';
const SITE_URL = 'https://ko-24-079-ctrl.github.io/pipilanu';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let totalStudySeconds = 0;
let timerInterval = null;
let heartbeatInterval = null;

const ACHIEVEMENTS = [
    { key: 'early_bird', name: '🌅 Ранний подъём', desc: 'Зашёл до 8:00' },
    { key: 'first_session', name: '🎯 Первый рывок', desc: 'Первая учебная сессия' },
    { key: 'marathoner', name: '🏃 Марафонец', desc: 'Учился 2 часа подряд' },
    { key: 'hardworker', name: '💪 Труженик', desc: 'Всего 10+ часов' },
    { key: 'activist', name: '🗣 Говорун', desc: 'Написал 20 сообщений' },
    { key: 'comeback', name: '🔄 Возвращение', desc: 'Вернулся после отдыха' },
    { key: 'soul', name: '⭐ Душа компании', desc: 'Написал 50 сообщений' }
];

function showNotification(title, message) {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.innerHTML = `<strong>${title}</strong><br><small>${message}</small>`;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function formatTime(sec) {
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    return `${days}д ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function updateTimerDisplay() {
    const timerEl = document.getElementById('timer');
    if (timerEl) timerEl.textContent = formatTime(totalStudySeconds);
}

async function loadTotalStats() {
    if (!currentUser) return;
    const { data } = await supabaseClient
        .from('study_stats')
        .select('total_seconds')
        .eq('user_id', currentUser.id)
        .maybeSingle();
    
    const totalStatsEl = document.getElementById('totalStats');
    if (totalStatsEl && data) {
        totalStatsEl.innerHTML = `Всего: ${formatTime(data.total_seconds)}`;
    } else if (totalStatsEl) {
        totalStatsEl.innerHTML = 'Всего: 0д 00:00:00';
    }
}

async function saveStudyTime() {
    if (!currentUser) return;
    const { data: existing } = await supabaseClient
        .from('study_stats')
        .select('total_seconds')
        .eq('user_id', currentUser.id)
        .maybeSingle();
    
    if (existing) {
        await supabaseClient
            .from('study_stats')
            .update({ total_seconds: totalStudySeconds, updated_at: new Date().toISOString() })
            .eq('user_id', currentUser.id);
    } else {
        await supabaseClient
            .from('study_stats')
            .insert({ user_id: currentUser.id, total_seconds: totalStudySeconds });
    }
    
    await supabaseClient
        .from('profiles')
        .update({ study_seconds: totalStudySeconds })
        .eq('id', currentUser.id);
    
    if (totalStudySeconds >= 36000) await unlockAchievement('hardworker');
    await loadTotalStats();
    await loadRating();
}

async function unlockAchievement(key) {
    if (!currentUser) return;
    const { data: existing } = await supabaseClient
        .from('user_achievements')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('achievement', key)
        .maybeSingle();
    if (existing) return;
    
    await supabaseClient.from('user_achievements').insert({
        user_id: currentUser.id,
        achievement: key
    });
    
    const ach = ACHIEVEMENTS.find(a => a.key === key);
    if (ach) showNotification('Новая награда!', ach.name);
    await loadAchievements();
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(async () => {
        totalStudySeconds++;
        updateTimerDisplay();
        if (totalStudySeconds % 30 === 0) await saveStudyTime();
        if (totalStudySeconds === 1) await unlockAchievement('first_session');
        if (totalStudySeconds >= 7200) await unlockAchievement('marathoner');
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

async function updateStatus(statusType) {
    if (!currentUser) return;
    const previousStatus = currentUser.status_type;
    
    if (statusType === 'study' && !timerInterval) {
        startTimer();
    } else if (statusType !== 'study' && timerInterval) {
        stopTimer();
        await saveStudyTime();
    }
    
    if (statusType === 'finish') {
        totalStudySeconds = 0;
        updateTimerDisplay();
        await saveStudyTime();
    }
    
    if (previousStatus === 'break' && statusType === 'study') {
        await unlockAchievement('comeback');
    }
    
    const statusLabels = {
        study: '📚 Учусь',
        break: '☕ Отдых',
        finish: '🏁 Финиш',
        exit: '🚪 Уход'
    };
    
    await supabaseClient.from('profiles').update({
        status_type: statusType,
        status: statusLabels[statusType],
        last_active: new Date().toISOString()
    }).eq('id', currentUser.id);
    
    currentUser.status_type = statusType;
    await loadGroup();
    await loadRating();
}

async function loadAchievements() {
    if (!currentUser) return;
    const { data } = await supabaseClient
        .from('user_achievements')
        .select('achievement')
        .eq('user_id', currentUser.id);
    const unlocked = new Set(data?.map(a => a.achievement) || []);
    
    const achievementsList = document.getElementById('achievementsList');
    if (achievementsList) {
        achievementsList.innerHTML = ACHIEVEMENTS.map(ach => `
            <div class="badge ${unlocked.has(ach.key) ? 'unlocked' : 'locked'}" title="${ach.desc}">
                ${ach.name}
            </div>
        `).join('');
    }
}

async function loadRating() {
    const { data } = await supabaseClient
        .from('profiles')
        .select('id, username, study_seconds')
        .order('study_seconds', { ascending: false })
        .limit(10);
    
    const ratingList = document.getElementById('ratingList');
    if (!ratingList) return;
    
    if (!data || data.length === 0) {
        ratingList.innerHTML = '<div>Нет данных</div>';
        return;
    }
    
    ratingList.innerHTML = data.map((user, index) => {
        let rankClass = '';
        if (index === 0) rankClass = 'gold';
        else if (index === 1) rankClass = 'silver';
        else if (index === 2) rankClass = 'bronze';
        
        const hours = Math.floor(user.study_seconds / 3600);
        const mins = Math.floor((user.study_seconds % 3600) / 60);
        
        return `
            <div class="rank-item">
                <div class="rank-number ${rankClass}">${index + 1}</div>
                <div><strong>${escapeHtml(user.username)}</strong> ${user.id === currentUser?.id ? '✓' : ''}</div>
                <div>${hours}ч ${mins}м</div>
            </div>
        `;
    }).join('');
}

async function loadGroup() {
    const { data } = await supabaseClient.from('profiles').select('*').order('username');
    if (!data) return;
    
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    
    const groupList = document.getElementById('groupList');
    if (!groupList) return;
    
    groupList.innerHTML = data.map(user => {
        const isOnline = user.status_type !== 'exit' && user.last_active && user.last_active > twoMinutesAgo;
        let statusIcon = '';
        switch(user.status_type) {
            case 'study': statusIcon = '📚'; break;
            case 'break': statusIcon = '☕'; break;
            case 'finish': statusIcon = '🏁'; break;
            default: statusIcon = '💤';
        }
        const hours = Math.floor(user.study_seconds / 3600);
        return `
            <div class="member">
                <div class="member-left">
                    <div class="online-dot ${isOnline ? 'online' : 'offline'}"></div>
                    <div>
                        <strong>${escapeHtml(user.username)}</strong>
                        <div style="font-size: 11px;">${statusIcon} ${user.status || '—'}</div>
                    </div>
                </div>
                <div>${hours}ч</div>
            </div>
        `;
    }).join('');
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input?.value.trim();
    if (!message || !currentUser) return;
    
    await supabaseClient.from('messages').insert({
        user_id: currentUser.id,
        username: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0],
        message: message
    });
    
    if (input) input.value = '';
    
    const { count } = await supabaseClient
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id);
    
    await supabaseClient.from('profiles').update({ messages_count: count }).eq('id', currentUser.id);
    
    if (count >= 20) await unlockAchievement('activist');
    if (count >= 50) await unlockAchievement('soul');
    await loadMessages();
}

async function loadMessages() {
    const { data } = await supabaseClient
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(50);
    
    const container = document.getElementById('chatMessages');
    if (!container) return;
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div style="text-align: center;">💬 Нет сообщений</div>';
        return;
    }
    
    container.innerHTML = data.map(msg => `
        <div class="message ${msg.user_id === currentUser?.id ? 'message-mine' : ''}">
            <div class="message-bubble">
                <div class="message-name">${escapeHtml(msg.username)}</div>
                <div>${escapeHtml(msg.message)}</div>
                <div class="message-time">${new Date(msg.created_at).toLocaleTimeString()}</div>
            </div>
        </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
}

async function showStats() {
    if (!currentUser) return;
    const { count: msgCount } = await supabaseClient
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', currentUser.id);
    
    const { data: achievements } = await supabaseClient
        .from('user_achievements')
        .select('achievement')
        .eq('user_id', currentUser.id);
    
    const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();
    
    const { data: studyStat } = await supabaseClient
        .from('study_stats')
        .select('total_seconds')
        .eq('user_id', currentUser.id)
        .maybeSingle();
    
    const totalSec = studyStat?.total_seconds || 0;
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    
    const statsContent = document.getElementById('statsContent');
    if (statsContent) {
        statsContent.innerHTML = `
            <div class="stat-item"><span>👤 Имя:</span><span>${escapeHtml(profile?.username)}</span></div>
            <div class="stat-item"><span>📧 Email:</span><span>${escapeHtml(profile?.email)}</span></div>
            <div class="stat-item"><span>⏱ Время учёбы:</span><span>${hours}ч ${mins}м</span></div>
            <div class="stat-item"><span>💬 Сообщений:</span><span>${msgCount || 0}</span></div>
            <div class="stat-item"><span>🏆 Наград:</span><span>${achievements?.length || 0}/${ACHIEVEMENTS.length}</span></div>
            <div class="stat-item"><span>🟢 Статус:</span><span>${profile?.status || '—'}</span></div>
        `;
    }
    const modal = document.getElementById('statsModal');
    if (modal) modal.classList.add('active');
}

async function updateHeartbeat() {
    if (!currentUser) return;
    await supabaseClient.from('profiles').update({ last_active: new Date().toISOString() }).eq('id', currentUser.id);
    await loadGroup();
}

function toggleTheme() {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
}

function loadTheme() {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
    }
}

function setupRealtime() {
    const channel = supabaseClient.channel('realtime-channel');
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        loadGroup();
        loadRating();
    });
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (payload.new && payload.new.user_id !== currentUser?.id) {
            showNotification(`Новое от ${payload.new.username}`, payload.new.message);
        }
        loadMessages();
    });
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'user_achievements' }, () => {
        loadAchievements();
    });
    channel.subscribe();
}

async function syncProfile(user) {
    const { data: existing } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
    
    if (!existing) {
        await supabaseClient.from('profiles').insert({
            id: user.id,
            username: user.user_metadata?.full_name || user.email?.split('@')[0],
            email: user.email,
            status_type: 'exit',
            status: '🚪 Уход',
            study_seconds: 0,
            messages_count: 0,
            last_active: new Date().toISOString()
        });
        totalStudySeconds = 0;
        updateTimerDisplay();
    } else {
        totalStudySeconds = existing.study_seconds || 0;
        updateTimerDisplay();
        if (existing.status_type === 'study') {
            startTimer();
        }
    }
    
    currentUser = { ...user, status_type: existing?.status_type || 'exit' };
    
    const hour = new Date().getHours();
    if (hour < 8) await unlockAchievement('early_bird');
    
    const today = new Date().toISOString().split('T')[0];
    const { data: todayLogin } = await supabaseClient
        .from('user_logins')
        .select('id')
        .eq('user_id', user.id)
        .gte('login_time', today)
        .maybeSingle();
    
    if (!todayLogin) {
        await supabaseClient.from('user_logins').insert({ user_id: user.id, login_time: new Date().toISOString() });
    }
    
    await loadAchievements();
    await loadTotalStats();
}

async function login() {
    await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: SITE_URL }
    });
}

async function logout() {
    stopTimer();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    await supabaseClient.auth.signOut();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

async function onAuthStateChange(user) {
    if (user) {
        await syncProfile(user);
        const userNameEl = document.getElementById('userName');
        const userAvatarEl = document.getElementById('userAvatar');
        if (userNameEl) userNameEl.textContent = user.user_metadata?.full_name || user.email;
        if (userAvatarEl) userAvatarEl.textContent = (user.user_metadata?.full_name || user.email || 'U')[0].toUpperCase();
        await loadGroup();
        await loadMessages();
        await loadRating();
        await loadAchievements();
        await loadTotalStats();
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(updateHeartbeat, 30000);
        setupRealtime();
        const loginPage = document.getElementById('loginPage');
        const app = document.getElementById('app');
        if (loginPage) loginPage.classList.add('hidden');
        if (app) app.classList.remove('hidden');
    } else {
        currentUser = null;
        stopTimer();
        const loginPage = document.getElementById('loginPage');
        const app = document.getElementById('app');
        if (loginPage) loginPage.classList.remove('hidden');
        if (app) app.classList.add('hidden');
    }
}

document.getElementById('googleLogin')?.addEventListener('click', login);
document.getElementById('logoutBtn')?.addEventListener('click', logout);
document.getElementById('sendBtn')?.addEventListener('click', sendMessage);
document.getElementById('messageInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});
document.getElementById('statsBtn')?.addEventListener('click', showStats);
document.getElementById('themeBtn')?.addEventListener('click', toggleTheme);
document.getElementById('closeModal')?.addEventListener('click', () => {
    const modal = document.getElementById('statsModal');
    if (modal) modal.classList.remove('active');
});
document.getElementById('statsModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('statsModal')) {
        document.getElementById('statsModal')?.classList.remove('active');
    }
});

document.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => updateStatus(btn.dataset.status));
});

supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
        onAuthStateChange(session.user);
    } else if (event === 'SIGNED_OUT') {
        onAuthStateChange(null);
    }
});

supabaseClient.auth.getSession().then(({ data: { session } }) => {
    onAuthStateChange(session?.user || null);
});

loadTheme();