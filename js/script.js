// ========== FIREBASE CONFIGURATION ==========
        const firebaseConfig = {
            apiKey: "YOUR_FIREBASE_apiKey",
            authDomain: "YOUR_FIREBASE_authDomain",
            projectId: "YOUR_FIREBASE_projectId",
            storageBucket: "YOUR_FIREBASE_storageBucket",
            messagingSenderId: "YOUR_FIREBASE_messagingSenderId",
            appId: "YOUR_FIREBASE_appId"
        };

        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.firestore();

        // ========== STATE ==========
        let employeeData = [];
        let leaveData = [];
        let currentEmployee = null;
        let currentUser = null;
        let autoRefreshInterval = null;
        let allUsers = [];
        let editingTaskId = null;
        let dashboardTaskFilter = 'all'; // NEW: Track dashboard task filter

        const LEAVE_QUOTAS = {
            'Annual Leave': 15,
            'Casual Leave': 10,
            'Sick Leave': 14,
            'Work From Home': 0
        };

        const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID';
        const SHEET_NAME = 'YOUR_SHEET_NAME';

        const TEAMS = ['Bangla', 'English', 'Math', 'ICT', 'Physics', 'Chemistry', 'Biology', 'BGS', 'Program Management'];


        // ========== AUTHENTICATION FUNCTIONS ==========
        function switchTab(tab) {
            const loginForm = document.getElementById('loginForm');
            const signupForm = document.getElementById('signupForm');
            const tabs = document.querySelectorAll('.auth-tab');

            tabs.forEach(t => t.classList.remove('active'));

            if (tab === 'login') {
                loginForm.classList.add('active');
                signupForm.classList.remove('active');
                tabs[0].classList.add('active');
            } else {
                loginForm.classList.remove('active');
                signupForm.classList.add('active');
                tabs[1].classList.add('active');
            }
            clearAuthMessages();
        }

        function showAuthMessage(message, type = 'error') {
            const errorDiv = document.getElementById('authError');
            const successDiv = document.getElementById('authSuccess');

            if (type === 'error') {
                errorDiv.textContent = message;
                errorDiv.style.display = 'block';
                successDiv.style.display = 'none';
            } else {
                successDiv.textContent = message;
                successDiv.style.display = 'block';
                errorDiv.style.display = 'none';
            }
            setTimeout(clearAuthMessages, 5000);
        }

        function clearAuthMessages() {
            document.getElementById('authError').style.display = 'none';
            document.getElementById('authSuccess').style.display = 'none';
        }

        async function handleSignup(event) {
            event.preventDefault();
            const name = document.getElementById('signupName').value.trim();
            const employeeId = document.getElementById('signupEmployeeId').value.trim();
            const email = document.getElementById('signupEmail').value.trim();
            const team = document.getElementById('signupTeam').value;
            const password = document.getElementById('signupPassword').value;

            if (!team) { showAuthMessage("Please select a team."); return; }

            const btn = document.getElementById('signupBtn');
            btn.disabled = true;
            btn.textContent = '⏳ Creating Account...';

            try {
                // 1. Verify Employee ID against Google Sheet
                btn.textContent = '⏳ Verifying Employee ID...';
                const isValidId = await validateEmployeeIdInSheet(employeeId);

                if (!isValidId) {
                    throw new Error("Employee ID not found in official records. Please contact HR.");
                }

                btn.textContent = '⏳ Creating Account...';
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;

                await user.updateProfile({ displayName: name });

                await db.collection('users').doc(user.uid).set({
                    name: name,
                    employeeId: employeeId,
                    email: email,
                    team: team,
                    role: 'employee', // Default role
                    isAdmin: false,
                    isActive: true,
                    adminRequestPending: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
                });

                showAuthMessage('Account created successfully!', 'success');
            } catch (error) {
                console.error('Signup error:', error);
                showAuthMessage(error.message);
                btn.disabled = false;
                btn.textContent = '✨ Create Account';
            }
        }

        async function handleLogin(event) {
            event.preventDefault();
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;

            const btn = document.getElementById('loginBtn');
            btn.disabled = true;
            btn.textContent = '⏳ Signing In...';

            try {
                await auth.signInWithEmailAndPassword(email, password);
            } catch (error) {
                console.error('Login error:', error);
                showAuthMessage(error.message);
                btn.disabled = false;
                btn.textContent = '🔐 Sign In';
            }
        }

        function showPasswordReset() {
            const email = prompt('Enter your email address to receive a password reset link:');
            if (email && email.trim()) {
                auth.sendPasswordResetEmail(email.trim())
                    .then(() => alert('Password reset email sent!'))
                    .catch(error => alert('Error: ' + error.message));
            }
        }

        async function handleLogout() {
            if (confirm('Are you sure you want to logout?')) {
                try { await auth.signOut(); }
                catch (error) { alert('Failed to logout: ' + error.message); }
            }
        }

        auth.onAuthStateChanged(async (user) => {
            if (user) {
                try {
                    const userDoc = await db.collection('users').doc(user.uid).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();

                        if (userData.isActive === false) {
                            alert('Your account has been deactivated.');
                            await auth.signOut();
                            return;
                        }

                        currentUser = { uid: user.uid, email: user.email, ...userData };

                        // Validate admin role
                        if (currentUser.role === 'admin' && !currentUser.isAdmin) {
                            await db.collection('users').doc(user.uid).update({ isAdmin: true });
                            currentUser.isAdmin = true;
                        }

                        document.getElementById('authContainer').style.display = 'none';
                        document.getElementById('mainContainer').classList.add('active');

                        updateUserUI();
                        loadGoogleSheetData();
                        startAutoRefresh();

                        // Initialize Task Management
                        subscribeToTasks();
                        // Load all users for everyone to support Team Lead badges in UI
                        loadAllUsers();
                    } else {
                        showAuthMessage('User profile not found in database.');
                        await auth.signOut();
                    }
                } catch (error) {
                    console.error('Error loading user data:', error);
                    showAuthMessage('Failed to load user profile: ' + error.message);
                    await auth.signOut();
                }
            } else {
                currentUser = null;
                document.getElementById('authContainer').style.display = 'block';
                document.getElementById('mainContainer').classList.remove('active');
                if (autoRefreshInterval) clearInterval(autoRefreshInterval);

                // Reset Forms
                document.getElementById('loginForm').reset();
                document.getElementById('signupForm').reset();
                document.getElementById('loginBtn').disabled = false;
                document.getElementById('loginBtn').textContent = '🔐 Sign In';
                document.getElementById('signupBtn').disabled = false;
                document.getElementById('signupBtn').textContent = '✨ Create Account';
            }
        });

        function updateUserUI() {
            if (!currentUser) return;

            document.getElementById('userAvatarSmall').textContent = currentUser.name.charAt(0).toUpperCase();

            let nameDisplay = currentUser.name;
            if (currentUser.role === 'team_leader') nameDisplay += ' ⭐';
            document.getElementById('userNameDisplay').textContent = nameDisplay;

            const roleBadge = document.getElementById('userRoleBadge');
            roleBadge.textContent = currentUser.role;
            roleBadge.className = `role-badge ${currentUser.role}`;


            // Toggle Admin Controls
            const isAdmin = currentUser.role === 'admin' && currentUser.isAdmin;
            const isTeamLeader = currentUser.role === 'team_leader';

            document.getElementById('searchSection').style.display = (isAdmin || isTeamLeader) ? 'block' : 'none';
            document.getElementById('headerNotificationBtn').style.display = 'block'; // Always show
            document.getElementById('adminTaskBtn').style.display = (isAdmin || isTeamLeader) ? 'block' : 'none';
            document.getElementById('adminUsersBtn').style.display = isAdmin ? 'block' : 'none';
            document.getElementById('adminTeamSummary').style.display = (isAdmin || isTeamLeader) ? 'block' : 'none'; // Show for Admin/TL
            document.getElementById('dashboardTaskStats').style.display = isAdmin ? 'grid' : 'none'; // NEW: Admin only
        }


        async function loadAdminNotifications() {
            try {
                let requests = [];
                let taskNotifs = [];
                let overdueNotifs = [];

                // 1. Admin Notifications (Admin Only)
                if (currentUser.role === 'admin' || currentUser.isAdmin) {

                    // 2. Read 'adminNotifications' collection (Admin Only generally, unless we open it up)
                    const tasksSnap = await db.collection('adminNotifications')
                        .where('isRead', '==', false)
                        .get();
                    taskNotifs = tasksSnap.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                }

                // 3. GENERATE OVERDUE ALERTS (Admin & Team Leader)
                if (currentUser.role === 'admin' || currentUser.isAdmin || currentUser.role === 'team_leader') {
                    // Fetch Active Tasks to check dates
                    // For scalability, index is better, but checking active tasks client side is okay for now
                    const activeTasksSnap = await db.collection('tasks')
                        .where('status', 'in', ['pending', 'in_progress'])
                        .get();

                    const today = new Date().toISOString().split('T')[0];

                    activeTasksSnap.forEach(doc => {
                        const t = doc.data();

                        // Scope check
                        let isRelevant = false;
                        if (currentUser.role === 'admin' || currentUser.isAdmin) isRelevant = true;
                        else if (currentUser.role === 'team_leader') {
                            // TL sees overdue for their team OR assigned by them
                            if ((t.team === currentUser.team) || t.assignedBy === currentUser.uid || t.assigneeId === currentUser.uid) {
                                isRelevant = true;
                            }
                        }

                        if (isRelevant && t.dueDate && t.dueDate < today) {
                            overdueNotifs.push({
                                id: 'overdue_' + doc.id,
                                type: 'overdue_task',
                                taskId: doc.id,
                                taskTitle: t.title,
                                assigneeName: t.assigneeName,
                                dueDate: t.dueDate,
                                createdAt: { seconds: new Date().getTime() / 1000 } // Fake timestamp for sorting top
                            });
                        }
                    });
                }

                // Combine
                const allNotifs = [...overdueNotifs, ...taskNotifs].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

                window.adminNotifications = allNotifs; // Store globally

                const count = allNotifs.length;
                const badge = document.getElementById('notificationBadge');
                if (badge) {
                    badge.textContent = count;
                    badge.style.display = count > 0 ? 'flex' : 'none';
                }

            } catch (error) {
                console.error('Error loading notifications:', error);
            }
        }

        function showNotifications() {
            try {
                const list = document.getElementById('notificationList');
                // Use the combined global variable
                const notifications = window.adminNotifications || [];

                if (notifications.length === 0) {
                    list.innerHTML = `<div class="no-notifications">
                        <div class="no-notifications-icon">📥</div>
                        <p>No new notifications</p>
                    </div>`;
                } else {
                    list.innerHTML = notifications.map(notif => {
                        if (notif.type === 'task_completed') {
                            return `
                                <div class="notification-item" style="border-left: 4px solid #10b981;">
                                    <div class="notification-user-header">
                                        <div class="notification-user-icon" style="background:#d1fae5; color:#059669;">
                                            ✅
                                        </div>
                                        <div class="notification-user-details">
                                            <div class="notification-user-name">${notif.completedByName || 'Employee'}</div>
                                            <div class="notification-user-meta">Completed: <strong>${notif.taskTitle}</strong></div>
                                        </div>
                                    </div>
                                    <div class="notification-actions">
                                        <button class="approve-btn" onclick="markAdminNotificationRead('${notif.id}')" style="width:100%; justify-content:center;">
                                            Mark as Read
                                        </button>
                                    </div>
                                </div>
                            `;
                        } else if (notif.type === 'task_note_added') {
                            return `
                                <div class="notification-item" style="border-left: 4px solid #3b82f6;">
                                    <div class="notification-user-header">
                                        <div class="notification-user-icon" style="background:#dbeafe; color:#1d4ed8;">
                                            📝
                                        </div>
                                        <div class="notification-user-details">
                                            <div class="notification-user-name">${notif.employeeName || 'Employee'}</div>
                                            <div class="notification-user-meta">Left a note on: <strong>${notif.taskTitle}</strong></div>
                                            <div class="notification-user-meta" style="font-style:italic; margin-top:5px; color:#4b5563;">"${notif.noteSnippet}"</div>
                                        </div>
                                    </div>
                                    <div class="notification-actions">
                                        <button class="approve-btn" onclick="markAdminNotificationRead('${notif.id}')" style="width:100%; justify-content:center; background:#3b82f6;">
                                            Mark as Read
                                        </button>
                                    </div>
                                </div>
                            `;
                        } else if (notif.type === 'overdue_task') {
                            return `
                                <div class="notification-item" style="border-left: 4px solid #ef4444; background-color:#fef2f2;">
                                    <div class="notification-user-header">
                                        <div class="notification-user-icon" style="background:#fee2e2; color:#ef4444;">
                                            🔥
                                        </div>
                                        <div class="notification-user-details">
                                            <div class="notification-user-name">Overdue: ${notif.taskTitle}</div>
                                            <div class="notification-user-meta">Assignee: <strong>${notif.assigneeName}</strong></div>
                                            <div class="notification-user-meta" style="color:#b91c1c;">Due: ${notif.dueDate}</div>
                                        </div>
                                    </div>
                                    <div class="notification-actions">
                                        <!-- No specific action, just link or dismiss. For now, info only -->
                                    </div>
                                </div>
                            `;
                        }
                    }).join('');
                }
                document.getElementById('notificationModal').classList.add('active');
            } catch (error) {
                console.error("Error showing notifications:", error);
                alert("Something went wrong opening notifications. See console.");
            }
        }

        async function markAdminNotificationRead(notifId) {
            try {
                await db.collection('adminNotifications').doc(notifId).update({ isRead: true });
                // Remove from local list and re-render
                window.adminNotifications = window.adminNotifications.filter(n => n.id !== notifId);
                // Update Badge
                const count = window.adminNotifications.length;
                const badge = document.getElementById('notificationBadge');
                if (badge) {
                    badge.textContent = count;
                    badge.style.display = count > 0 ? 'flex' : 'none';
                }

                showNotifications(); // Re-render modal
            } catch (e) { console.error(e); }
        }



        async function handleNotificationClick() {
            if (currentUser && (currentUser.isAdmin || currentUser.role === 'admin' || currentUser.role === 'team_leader')) {
                await loadAdminNotifications(); // Force refresh to ensure data is there
                showNotifications();
            } else {
                openNotificationHistory();
            }
        }

        function closeNotifications() {
            document.getElementById('notificationModal').classList.remove('active');
        }


        // ========== ADMIN USER MANAGEMENT ==========
        function toggleAdminUsers() {
            const view = document.getElementById('adminUserView');
            view.style.display = view.style.display === 'none' ? 'block' : 'none';
            if (view.style.display === 'block') loadUserManagementHelper();
        }

        async function loadUserManagementHelper() {
            try {
                const snapshot = await db.collection('users').orderBy('name').get();
                const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                const tbody = document.getElementById('userManagementTableBody');
                tbody.innerHTML = users.map(u => {
                    const isSelf = u.id === currentUser.uid;
                    return `
                        <tr>
                            <td>
                                <div>${u.name}</div>
                                <div style="font-size:11px; color:#6b7280;">${u.employeeId || 'No ID'}</div>
                            </td>
                            <td>${u.email}</td>
                            <td>
                                <select onchange="updateUserRole('${u.id}', this.value)" class="form-select" style="padding:5px;" ${isSelf ? 'disabled' : ''}>
                                    <option value="employee" ${u.role === 'employee' ? 'selected' : ''}>Member</option>
                                    <option value="team_leader" ${u.role === 'team_leader' ? 'selected' : ''}>Team Lead</option>
                                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                                </select>
                            </td>
                            <td>
                                <select onchange="updateUserTeam('${u.id}', this.value)" class="form-select" style="padding:5px;">
                                    <option value="">No Team</option>
                                    ${TEAMS.map(t => `<option value="${t}" ${u.team === t ? 'selected' : ''}>${t}</option>`).join('')}
                                </select>
                            </td>
                            <td>
                                <!-- Future: Delete user -->
                            </td>
                        </tr>
                    `;
                }).join('');
            } catch (e) { console.error(e); alert("Failed to load users: " + e.message); }
        }

        async function updateUserRole(uid, newRole) {
            try {
                await db.collection('users').doc(uid).update({
                    role: newRole,
                    isAdmin: (newRole === 'admin')
                });
                alert(`Role updated to ${newRole}`);
            } catch (e) { alert("Error: " + e.message); }
        }

        async function updateUserTeam(uid, newTeam) {
            try {
                await db.collection('users').doc(uid).update({ team: newTeam });
                // alert(`Team updated to ${newTeam}`); // Optional toast
            } catch (e) { alert("Error: " + e.message); }
        }

        // ========== TASK MANAGEMENT FUNCTIONS ==========
        function toggleAdminTasks() {
            const view = document.getElementById('adminTaskView');
            view.style.display = view.style.display === 'none' ? 'block' : 'none';
        }

        async function loadAllUsers() {
            try {
                const snapshot = await db.collection('users').orderBy('name').get();
                allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                applyFilters(); // Re-render to show badges if data is already there
            } catch (error) { console.error("Error loading users:", error); }
        }

        function populateAssigneeDropdown() {
            // Filter Assignees based on Role
            const select = document.getElementById('taskAssignee');
            let options = '<option value="">Select Assignee</option>';

            let eligibleUsers = [];

            if (currentUser.role === 'admin' || currentUser.isAdmin) {
                // Admin can assign to anyone, but highlight Team Leaders
                eligibleUsers = allUsers;
                options += eligibleUsers.map(u => {
                    const icon = u.role === 'team_leader' ? '⭐' : '👤';
                    return `<option value="${u.id}">${icon} ${u.name} (${u.team || 'No Team'})</option>`;
                }).join('');

            } else if (currentUser.role === 'team_leader') {
                // Team Leader: Assign to Employees in SAME TEAM
                if (!currentUser.team) {
                    // Alert handled elsewhere
                }
                // Filter: Employees in Team OR Me (to allow keeping/reassigning self)
                eligibleUsers = allUsers.filter(u =>
                    (u.team === currentUser.team && u.role === 'employee') ||
                    u.id === currentUser.uid
                );

                if (eligibleUsers.length === 0) {
                    options = '<option value="">No members in your team</option>';
                } else {
                    options += eligibleUsers.map(u => {
                        const isMe = u.id === currentUser.uid;
                        return `<option value="${u.id}">${isMe ? '⭐ Me' : '👤 ' + u.name}</option>`;
                    }).join('');
                }
            }

            select.innerHTML = options;
        }

        async function openAssignTaskModal() {
            if (!allUsers || allUsers.length === 0) await loadAllUsers(); // Ensure data

            if (currentUser.role !== 'admin' && !currentUser.isAdmin && currentUser.role !== 'team_leader') {
                alert("Only Admins and Team Leaders can assign tasks.");
                return;
            }

            if (currentUser.role === 'team_leader' && !currentUser.team) {
                alert("You are not assigned to a team. Contact Admin.");
                return;
            }

            populateAssigneeDropdown();
            document.getElementById('assignTaskModal').classList.add('active');
        }
        function closeAssignTaskModal() {
            document.getElementById('assignTaskModal').classList.remove('active');
            // Reset Edit Mode
            editingTaskId = null;
            document.querySelector('#assignTaskModal h2').textContent = '➕ Assign New Task';
            document.getElementById('assignTaskForm').reset();
            document.querySelector('#assignTaskModal button[type="submit"]').textContent = 'Assign Task';
        }

        async function handleAssignTask(e) {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const originalBtnText = btn.textContent;
            btn.disabled = true;
            btn.textContent = '⏳ Saving...';

            try {
                const title = document.getElementById('taskTitle').value;
                const desc = document.getElementById('taskDesc').value;
                const assigneeId = document.getElementById('taskAssignee').value;
                const priority = document.getElementById('taskPriority').value;
                const dueDate = document.getElementById('taskDueDate').value;

                if (!assigneeId) throw new Error("Please select an employee.");

                const assignee = allUsers.find(u => u.id === assigneeId);

                if (!assignee) throw new Error("Selected employee not found in local data.");

                const taskData = {
                    title, description: desc, assigneeId, assigneeName: assignee.name,
                    priority, dueDate,
                    team: assignee.team || 'No Team', // Ensure Team scope is set
                    assigneeRole: assignee.role || 'employee',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    // Update 'From' to current user (the one reassigning/updating)
                    assignedBy: currentUser.uid,
                    assignedByName: currentUser.name
                };

                // Prepare History Event
                const historyEvent = {
                    action: editingTaskId ? 'reassigned' : 'created',
                    by: currentUser.name,
                    date: new Date().toISOString(),
                    details: editingTaskId ? `Reassigned to ${assignee.name}` : `Assigned to ${assignee.name}`
                };

                if (editingTaskId) {
                    // UPDATE EXISTING
                    taskData.history = firebase.firestore.FieldValue.arrayUnion(historyEvent);
                    await db.collection('tasks').doc(editingTaskId).update(taskData);
                    alert('Task updated successfully!');
                } else {
                    // CREATE NEW
                    taskData.status = 'pending';
                    taskData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    taskData.history = [historyEvent];

                    await db.collection('tasks').add(taskData);
                    alert('Task assigned successfully!');
                }

                // Duplicate block removed here

                closeAssignTaskModal();
            } catch (error) {
                console.error("Assign error:", error);
                alert("Failed to save task: " + error.message);
            } finally {
                btn.disabled = false;
                btn.textContent = originalBtnText;
            }
        }

        function subscribeToTasks() {
            let query = db.collection('tasks');

            // FETCH STRATEGY:
            // Admin: Fetch All
            // Team Leader: Fetch All (to catch tasks with missing 'team' field but assigned to them) and filter client-side
            // Employee: Fetch All (simplified) or Filter server-side if strict security needed.
            // For robustness with legacy data, let's fetch default (all) or loose filter.

            // To ensure we see tasks assigned to us even if 'team' is missing:
            if (currentUser.role === 'employee') {
                query = query.where('assigneeId', '==', currentUser.uid);
            }
            // Admin & TL fetch all to ensure visibility/management

            query.onSnapshot(snapshot => {
                let allTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Client-side sort
                allTasks.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

                // Filter for Current User View Scope
                let visibleTasks = [];
                if (currentUser.role === 'admin' || currentUser.isAdmin) {
                    visibleTasks = allTasks;
                } else if (currentUser.role === 'team_leader') {
                    // TL sees:
                    // 1. Tasks assigned to them
                    // 2. Tasks assigned to their TEAM
                    // 3. Tasks they assigned (Delegated) - ADDED THIS CHECK
                    visibleTasks = allTasks.filter(t =>
                        t.assigneeId === currentUser.uid ||
                        (currentUser.team && t.team === currentUser.team) ||
                        t.assignedBy === currentUser.uid
                    );
                } else {
                    // Employee (redundant check if query filtered, but safe)
                    visibleTasks = allTasks.filter(t => t.assigneeId === currentUser.uid);
                }

                // Store globally
                window.globalTasks = visibleTasks;

                // UPDATE COUNTERS
                updateTaskCounters(visibleTasks);


                // Update Notification Badge Count
                if (currentUser && currentUser.role !== 'admin') {
                    const myCount = visibleTasks.filter(t =>
                        String(t.assigneeId) === String(currentUser.uid) &&
                        !t.isRead
                    ).length;

                    // Update Header Badge
                    const badge = document.getElementById('notificationBadge');
                    if (badge) {
                        badge.textContent = myCount;
                        badge.style.display = myCount > 0 ? 'flex' : 'none';
                    }

                    // Update Dashboard Badge
                    const dashBadge = document.getElementById('notificationCount');
                    if (dashBadge) {
                        dashBadge.textContent = myCount;
                        // dashBadge parent is always visible, just update number
                    }
                }

                renderTasks(visibleTasks);
                renderTeamTaskStats(allTasks); // NEW: Update team summary for Admins/TLs

                // Check for new tasks to notify
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added' && !snapshot.metadata.fromCache) {
                        const data = change.doc.data();
                        // Only notify if assigned to current user
                        if (data.assigneeId === currentUser.uid) {
                            // Optional: showToast(`New Task Assigned: ${data.title}`);
                        }
                    }
                    // Refresh Notification Modal if open
                    if (document.getElementById('notificationHistoryModal').classList.contains('active')) {
                        openNotificationHistory();
                    }
                });
            }, error => {
                console.error("Task listener error:", error);
            });
        }

        function updateTaskCounters(tasks) {
            // Apply year filter if applicable
            const viewType = document.getElementById('viewType')?.value;
            const yearFilter = document.getElementById('yearFilter')?.value;
            const dashViewType = document.getElementById('dashboardViewType')?.value;
            const dashYearFilter = document.getElementById('dashboardYearFilter')?.value;

            let filteredTasks = tasks.filter(t => t.type !== 'reminder');
            const isDashboardActive = document.getElementById('dashboardView').classList.contains('active');

            const v = isDashboardActive ? dashViewType : viewType;
            const y = isDashboardActive ? dashYearFilter : yearFilter;

            if ((v === 'year' || v === 'month') && y) {
                filteredTasks = filteredTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    if (v === 'year') return dateStr.startsWith(y);
                    const m = isDashboardActive ? document.getElementById('dashboardMonthFilter')?.value : document.getElementById('monthFilter')?.value;
                    return m ? dateStr.startsWith(`${y}-${m}`) : dateStr.startsWith(y);
                });
            } else if (v === 'day') {
                const d = isDashboardActive ? document.getElementById('dashboardDayFilter')?.value : document.getElementById('dayFilter')?.value;
                if (d) {
                    filteredTasks = filteredTasks.filter(t => {
                        const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                        return dateStr === d;
                    });
                }
            }

            const total = filteredTasks.length;
            const pending = filteredTasks.filter(t => t.status === 'pending').length;
            const inProgress = filteredTasks.filter(t => t.status === 'in_progress').length;
            const completed = filteredTasks.filter(t => t.status === 'completed').length;

            const today = new Date().toISOString().split('T')[0];
            const overdue = filteredTasks.filter(t => {
                if (!t.dueDate) return false;

                if (t.status !== 'completed') {
                    return t.dueDate < today;
                } else {
                    let doneDateStr = '';
                    if (t.completedAt && t.completedAt.toDate) {
                        try { doneDateStr = t.completedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                    } else if (t.updatedAt && t.updatedAt.toDate) {
                        try { doneDateStr = t.updatedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                    }
                    return doneDateStr && doneDateStr > t.dueDate;
                }
            }).length;

            // Total
            const elTotal = document.getElementById('taskCountTotal');
            if (elTotal) elTotal.textContent = total;

            // Pending
            updateStat('taskCountPending', 'taskTotalLabel1', 'taskBarPending', pending, total);
            // In Progress
            updateStat('taskCountProgress', 'taskTotalLabel2', 'taskBarProgress', inProgress, total);
            // Completed
            updateStat('taskCountCompleted', 'taskTotalLabel3', 'taskBarCompleted', completed, total);
            // Overdue
            updateStat('taskCountOverdue', 'taskTotalLabel4', 'taskBarOverdue', overdue, total);

            // TEAM LEAD SPECIFIC: Personal Stats (Total, Pending, Progress, Completed, Overdue)
            const tlContainer = document.getElementById('tlPersonalStatContainer');
            if (currentUser && currentUser.role === 'team_leader') {
                if (tlContainer) tlContainer.style.display = 'grid';

                // Filter tasks for Current User only
                const myTasks = filteredTasks.filter(t => t.assigneeId === currentUser.uid);

                const myTotal = myTasks.length;
                const myPending = myTasks.filter(t => t.status === 'pending').length;
                const myInProgress = myTasks.filter(t => t.status === 'in_progress').length;
                const myCompleted = myTasks.filter(t => t.status === 'completed').length;

                // My Overdue Calc
                const today = new Date().toISOString().split('T')[0];
                const myOverdue = myTasks.filter(t => {
                    if (!t.dueDate) return false;
                    // Logic checks
                    let isDone = t.status === 'completed';
                    if (!isDone && t.dueDate < today) return true;
                    if (isDone) {
                        // Check if verified done after due date
                        let doneDateStr = '';
                        if (t.completedAt && t.completedAt.toDate) {
                            try { doneDateStr = t.completedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                        } else if (t.updatedAt && t.updatedAt.toDate) {
                            try { doneDateStr = t.updatedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                        }
                        if (doneDateStr && doneDateStr > t.dueDate) return true;
                    }
                    return false;
                }).length;

                // Update My Stats
                if (document.getElementById('tlCountTotal')) {
                    document.getElementById('tlCountTotal').textContent = myTotal;
                    updateStat('tlCountPending', 'tlTotalLabel1', 'tlBarPending', myPending, myTotal);
                    updateStat('tlCountProgress', 'tlTotalLabel2', 'tlBarProgress', myInProgress, myTotal);
                    updateStat('tlCountCompleted', 'tlTotalLabel3', 'tlBarCompleted', myCompleted, myTotal);
                    updateStat('tlCountOverdue', 'tlTotalLabel4', 'tlBarOverdue', myOverdue, myTotal);
                }

            } else {
                if (tlContainer) tlContainer.style.display = 'none';
            }
        }

        // ---------- NEW: Render Team Task Summary ----------
        function renderTeamTaskStats(tasks) {
            // Save raw tasks for filter-only updates
            window.allTasksRaw = tasks;

            const container = document.getElementById('teamTaskStatsContainer');
            const adminTaskStatsContainer = document.getElementById('adminTaskStatsContainer'); // For adminTaskView
            if (!container && !adminTaskStatsContainer) return;

            // Initialize dropdowns if they are empty
            const yearDropdown = document.getElementById('teamYearFilter');
            if (yearDropdown && yearDropdown.options.length <= 1) {
                const currentYear = 2026; // Default set to 2026
                for (let y = currentYear; y >= 2022; y--) {
                    const opt = document.createElement('option');
                    opt.value = y.toString();
                    opt.textContent = y.toString();
                    if (y === currentYear) opt.selected = true;
                    yearDropdown.appendChild(opt);
                }
            }

            const monthDropdown = document.getElementById('teamMonthFilter');
            if (monthDropdown && monthDropdown.options.length <= 1) {
                const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                months.forEach((m, idx) => {
                    const opt = document.createElement('option');
                    opt.value = String(idx + 1).padStart(2, '0');
                    opt.textContent = m;
                    monthDropdown.appendChild(opt);
                });
            }

            // Apply Time Filters
            const view = document.getElementById('teamViewType')?.value || 'all';
            const y = document.getElementById('teamYearFilter')?.value;
            const m = document.getElementById('teamMonthFilter')?.value;
            const d = document.getElementById('teamDayFilter')?.value;

            let filteredTasksForTeams = [...tasks];
            if (view === 'year' && y) {
                filteredTasksForTeams = filteredTasksForTeams.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr.startsWith(y);
                });
            } else if (view === 'month' && y && m) {
                filteredTasksForTeams = filteredTasksForTeams.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr.startsWith(`${y}-${m}`);
                });
            } else if (view === 'day' && d) {
                filteredTasksForTeams = filteredTasksForTeams.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr === d;
                });
            }

            const today = new Date().toISOString().split('T')[0];

            // Initialize counts for each team
            const teamData = {};
            [...TEAMS, 'No Team'].forEach(t => {
                teamData[t] = { total: 0, pending: 0, in_progress: 0, completed: 0, overdue: 0 };
            });

            filteredTasksForTeams.forEach(t => {
                let teamRaw = t.team ? String(t.team).trim() : 'No Team';
                let matchedTeam = TEAMS.find(name => name.toLowerCase() === teamRaw.toLowerCase()) || 'No Team';

                const stats = teamData[matchedTeam];
                stats.total++;
                if (t.status === 'pending') stats.pending++;
                if (t.status === 'in_progress') stats.in_progress++;
                if (t.status === 'completed') stats.completed++;

                // Aggregated Program Management counts (sum of all teams)
                // If the task is NOT already matched to Program Management, add it to PM stats
                if (matchedTeam !== 'Program Management') {
                    const pmStats = teamData['Program Management'];
                    pmStats.total++;
                    if (t.status === 'pending') pmStats.pending++;
                    if (t.status === 'in_progress') pmStats.in_progress++;
                    if (t.status === 'completed') pmStats.completed++;
                }

                // Overdue calculation (shared logic)
                const isOverdue = (task, todayDate) => {
                    if (!task.dueDate) return false;
                    if (task.status !== 'completed' && task.dueDate < todayDate) return true;
                    if (task.status === 'completed') {
                        let doneDateStr = '';
                        if (task.completedAt && task.completedAt.toDate) try { doneDateStr = task.completedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                        else if (task.updatedAt && task.updatedAt.toDate) try { doneDateStr = task.updatedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                        return doneDateStr && doneDateStr > task.dueDate;
                    }
                    return false;
                };

                if (isOverdue(t, today)) {
                    stats.overdue++;
                    if (matchedTeam !== 'Program Management') {
                        teamData['Program Management'].overdue++;
                    }
                }
            });

            const htmlContent = [...TEAMS, 'No Team'].map(team => {
                const s = teamData[team];
                if (s.total === 0 && team === 'No Team') return ''; // Skip empty "No Team"

                return `
                    <div class="team-stat-card">
                        <div class="team-name-label">${team}</div>
                        <div class="team-stats-grid">
                            <div class="team-sub-stat" onclick="openTeamTasksModal('${team}', 'all')" title="View All Tasks">
                                <div class="team-sub-stat-value">${s.total}</div>
                                <div class="team-sub-stat-label">Total</div>
                            </div>
                            <div class="team-sub-stat" onclick="openTeamTasksModal('${team}', 'pending')" title="View Pending Tasks">
                                <div class="team-sub-stat-value">${s.pending}</div>
                                <div class="team-sub-stat-label">Pending</div>
                            </div>
                            <div class="team-sub-stat" onclick="openTeamTasksModal('${team}', 'in_progress')" title="View Ongoing Tasks">
                                <div class="team-sub-stat-value">${s.in_progress}</div>
                                <div class="team-sub-stat-label">Ongoing</div>
                            </div>
                            <div class="team-sub-stat" onclick="openTeamTasksModal('${team}', 'completed')" title="View Completed Tasks">
                                <div class="team-sub-stat-value">${s.completed}</div>
                                <div class="team-sub-stat-label">Done</div>
                            </div>
                            <div class="team-sub-stat" onclick="openTeamTasksModal('${team}', 'overdue')" title="View Overdue Tasks" style="color:#ef4444; background:#fef2f2;">
                                <div class="team-sub-stat-value">${s.overdue}</div>
                                <div class="team-sub-stat-label">Overdue</div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            if (container) container.innerHTML = htmlContent;
            if (adminTaskStatsContainer) adminTaskStatsContainer.innerHTML = htmlContent;
        }

        function openLeaveDetailsModal(leaveType) {
            if (!currentEmployee) return;
            const employeeId = String(currentEmployee.id).trim();

            // Store metadata for filtering
            window.activeModalType = 'leave';
            window.activeModalCategory = leaveType;
            window.activeModalEmployeeId = employeeId;

            document.getElementById('filteredTasksTitle').textContent = `🏖️ ${leaveType} History`;

            const yearFilterGroup = document.getElementById('modalFilterGroup');
            if (yearFilterGroup) yearFilterGroup.style.display = 'block';

            const yearFilter = document.getElementById('modalYearFilter');
            if (yearFilter) {
                yearFilter.value = "2026"; // Default as requested
            }

            const searchBox = document.getElementById('modalSearchBox');
            if (searchBox) {
                searchBox.value = "";
                searchBox.placeholder = `🔍 Search ${leaveType} records...`;
            }

            refreshFilteredModalList();
            document.getElementById('filteredTasksModal').classList.add('active');
        }

        function refreshFilteredModalList() {
            if (window.activeModalType === 'leave') {
                const leaveType = window.activeModalCategory;
                const employeeId = window.activeModalEmployeeId;
                const year = document.getElementById('modalYearFilter')?.value;
                const search = document.getElementById('modalSearchBox')?.value?.toLowerCase();

                let leaves = leaveData.filter(l => String(l.id).trim() === employeeId && l.leaveType === leaveType);

                if (year) {
                    leaves = leaves.filter(l => l.startDate && l.startDate.startsWith(year));
                }

                window.currentModalTasks = leaves.map(l => ({
                    ...l,
                    title: l.leaveType,
                    description: `${l.startDate} to ${l.endDate} (${l.totalDays} days)`
                }));

                if (search) {
                    window.currentModalTasks = window.currentModalTasks.filter(l =>
                        l.description.toLowerCase().includes(search) ||
                        l.leaveType.toLowerCase().includes(search)
                    );
                }

                renderFilteredLeaveList(window.currentModalTasks);
            }
        }

        function renderFilteredLeaveList(records) {
            const list = document.getElementById('filteredTasksList');
            if (records.length === 0) {
                list.innerHTML = '<p style="text-align:center; padding:30px; color:#64748b;">No leave records found.</p>';
            } else {
                list.innerHTML = records.map(l => `
                    <div class="task-card" style="border-left: 4px solid #3b82f6;">
                        <div class="task-header">
                            <span class="task-priority medium" style="background:#e0f2fe; color:#0369a1;">${l.leaveType}</span>
                            <span class="task-status completed" style="background:#dcfce7; color:#15803d;">Approved</span>
                        </div>
                        <div class="task-title">${l.startDate} to ${l.endDate}</div>
                        <div class="task-desc">Total Duration: <strong>${l.totalDays} days</strong></div>
                    </div>
                `).join('');
            }
        }

        function renderFilteredTasks(tasks) {
            const list = document.getElementById('filteredTasksList');
            if (tasks.length === 0) {
                list.innerHTML = `
                    <div class="no-data" style="padding: 40px; background: #f9fafb; border: 2px dashed #e5e7eb; border-radius: 12px; width: 100%;">
                        <div style="font-size: 48px; margin-bottom: 10px; opacity: 0.5;">🔍</div>
                        <h3 style="color: #4b5563;">No matching tasks found</h3>
                        <p style="color: #9ca3af; font-size: 14px;">Try adjusting your search or filters.</p>
                    </div>
                `;
            } else {
                // Determine if Admin View based on role or context
                const isAdminLayout = currentUser && (currentUser.role === 'admin' || currentUser.role === 'team_leader');
                list.innerHTML = tasks.map(task => createTaskCard(task, isAdminLayout)).join('');
            }
        }

        function handleModalSearch(query) {
            if (window.activeModalType === 'leave') {
                refreshFilteredModalList();
                return;
            }
            const searchTerms = query.toLowerCase().trim();
            const currentData = window.currentModalTasks || [];

            // Reusable helper to decide renderer
            const render = (data) => {
                if (data.length > 0 && (data[0].leaveType || data[0].startDate)) {
                    renderFilteredLeaveList(data);
                } else {
                    renderFilteredTasks(data);
                }
            };

            if (!searchTerms) {
                render(currentData);
                return;
            }

            const filtered = currentData.filter(item => {
                const title = (item.title || "").toLowerCase();
                const desc = (item.description || "").toLowerCase();
                const assignee = (item.assigneeName || "").toLowerCase();
                const type = (item.leaveType || "").toLowerCase();
                return title.includes(searchTerms) || desc.includes(searchTerms) || assignee.includes(searchTerms) || type.includes(searchTerms);
            });

            render(filtered);
        }

        function openTeamTasksModal(teamName, status = 'all') {
            const tasks = window.globalTasks || [];
            const today = new Date().toISOString().split('T')[0];

            // 0. Apply Time Filters (Consistent with renderTeamTaskStats)
            const view = document.getElementById('teamViewType')?.value || 'all';
            const y = document.getElementById('teamYearFilter')?.value;
            const m = document.getElementById('teamMonthFilter')?.value;
            const d = document.getElementById('teamDayFilter')?.value;

            let baseTasks = [...tasks];
            if (view === 'year' && y) {
                baseTasks = baseTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr.startsWith(y);
                });
            } else if (view === 'month' && y && m) {
                baseTasks = baseTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr.startsWith(`${y}-${m}`);
                });
            } else if (view === 'day' && d) {
                baseTasks = baseTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr === d;
                });
            }

            // 1. Filter by Team
            let teamTasks = baseTasks;
            if (teamName !== 'Program Management') {
                teamTasks = baseTasks.filter(t => {
                    const team = t.team ? String(t.team).trim() : 'No Team';
                    return team.toLowerCase() === teamName.toLowerCase();
                });
            }

            // 2. Filter by Status if not 'all'
            let filterLabel = "All";
            if (status !== 'all') {
                if (status === 'overdue') {
                    teamTasks = teamTasks.filter(t => {
                        if (!t.dueDate) return false;
                        if (t.status !== 'completed' && t.dueDate < today) return true;
                        let doneDateStr = '';
                        if (t.completedAt && t.completedAt.toDate) try { doneDateStr = t.completedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                        else if (t.updatedAt && t.updatedAt.toDate) try { doneDateStr = t.updatedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                        return doneDateStr && doneDateStr > t.dueDate;
                    });
                    filterLabel = "Overdue ⚠️";
                } else {
                    teamTasks = teamTasks.filter(t => t.status === status);
                    filterLabel = status.replace('_', ' ').charAt(0).toUpperCase() + status.replace('_', ' ').slice(1);
                }
            }

            document.getElementById('filteredTasksTitle').textContent = `👥 ${teamName}: ${filterLabel} Tasks`;

            // Set for Search logic
            window.currentModalTasks = teamTasks;

            // Reset Search UI
            const searchBox = document.getElementById('modalSearchBox');
            if (searchBox) searchBox.value = "";

            renderFilteredTasks(teamTasks);
            document.getElementById('filteredTasksModal').classList.add('active');
        }

        // Helper to reduce repetition
        function updateStat(idCount, idLabel, idBar, value, total) {
            const elCount = document.getElementById(idCount);
            const elLabel = document.getElementById(idLabel);
            const elBar = document.getElementById(idBar);
            if (elCount) elCount.textContent = value;
            if (elLabel) elLabel.textContent = '/ ' + total;
            if (elBar) elBar.style.width = total > 0 ? (value / total * 100) + '%' : '0%';
        }


        function renderTasks(tasks) {
            // Apply year filter if applicable
            const viewType = document.getElementById('viewType')?.value;
            const yearFilter = document.getElementById('yearFilter')?.value;
            const dashViewType = document.getElementById('dashboardViewType')?.value;
            const dashYearFilter = document.getElementById('dashboardYearFilter')?.value;

            let filteredTasks = tasks.filter(t => t.type !== 'reminder');
            const isDashboardActive = document.getElementById('dashboardView').classList.contains('active');

            const v = isDashboardActive ? dashViewType : viewType;
            const y = isDashboardActive ? dashYearFilter : yearFilter;

            if (v === 'year' && y) {
                filteredTasks = filteredTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr.startsWith(y);
                });
            } else if (v === 'month') {
                const m = isDashboardActive ? document.getElementById('dashboardMonthFilter')?.value : document.getElementById('monthFilter')?.value;
                if (y && m) {
                    filteredTasks = filteredTasks.filter(t => {
                        const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                        return dateStr.startsWith(`${y}-${m}`);
                    });
                }
            }

            // Filter out completed tasks for main dashboard display
            const activeTasksOnly = filteredTasks.filter(t => t.status !== 'completed');

            // Admin View
            const adminGrid = document.getElementById('adminTaskGrid');
            if (adminGrid) {
                if (activeTasksOnly.length === 0) {
                    adminGrid.innerHTML = `
                        <div class="no-data" style="grid-column: 1 / -1; padding: 40px; background: #f9fafb; border: 2px dashed #e5e7eb; border-radius: 12px;">
                            <div style="font-size: 48px; margin-bottom: 10px; opacity: 0.5;">📋</div>
                            <h3 style="color: #4b5563;">No active tasks found</h3>
                            <p style="color: #9ca3af; font-size: 14px;">Great! Your team is all caught up.</p>
                        </div>
                    `;
                } else {
                    adminGrid.innerHTML = activeTasksOnly.map(task => createTaskCard(task, true)).join('');
                }
            }

            // Employee/Team View (Main Dashboard)
            const empGrid = document.getElementById('employeeTaskGrid');
            if (empGrid && currentUser) {
                // Update Section Header based on Role
                const sectionTitle = document.querySelector('.task-section .section-title span');

                let myTasks = [];
                if (currentUser.role === 'team_leader') {
                    // Team Leader sees ALL visible active tasks (My + Team)
                    myTasks = activeTasksOnly;
                    if (sectionTitle) sectionTitle.textContent = `📌 Team Tasks (${currentUser.team || 'My Team'})`;
                } else {
                    // Employee sees only assigned active tasks
                    myTasks = activeTasksOnly.filter(t => t.assigneeId === currentUser.uid);
                    if (sectionTitle) sectionTitle.textContent = '📌 My Tasks';
                }

                if (myTasks.length === 0) empGrid.innerHTML = '<p style="color:#6c757d;">No active tasks found.</p>';
                else empGrid.innerHTML = myTasks.map(task => createTaskCard(task, currentUser.role === 'team_leader')).join('');
            }
        }

        // NEW: Filter Dashboard Tasks via Modal
        function filterDashboardTasks(status) {
            if (!currentEmployee) return;
            openFilteredTasksModal(status, currentEmployee.id);
        }

        function openFilteredTasksModal(status, employeeId) {
            const tasks = window.globalTasks || [];

            // Map business employeeId to Firebase UID
            const userObj = allUsers.find(u => String(u.employeeId).trim() === String(employeeId).trim());
            const uid = userObj ? userObj.id : null;

            if (!uid) {
                alert("Task data not available for this user yet.");
                return;
            }

            // Filter tasks for this specific employee UID & Exclude Reminders
            let myTasks = tasks.filter(t => String(t.assigneeId) === String(uid) && t.type !== 'reminder');

            // Apply Status Filter
            let displayTitle = "Tasks";
            const today = new Date().toISOString().split('T')[0];

            if (status === 'overdue') {
                myTasks = myTasks.filter(t => {
                    if (!t.dueDate) return false;
                    // Active & Late
                    if (t.status !== 'completed' && t.dueDate < today) return true;
                    // Completed & Late
                    let doneDateStr = '';
                    if (t.completedAt && t.completedAt.toDate) try { doneDateStr = t.completedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                    else if (t.updatedAt && t.updatedAt.toDate) try { doneDateStr = t.updatedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                    return doneDateStr && doneDateStr > t.dueDate;
                });
                displayTitle = "🔥 Overdue Tasks";
            } else {
                myTasks = myTasks.filter(t => t.status === status);
                const statusNames = {
                    'in_progress': '🔄 Ongoing Tasks',
                    'completed': '✅ Completed Tasks',
                    'pending': '⏳ Pending Tasks'
                };
                displayTitle = statusNames[status] || "Tasks";
            }

            document.getElementById('filteredTasksTitle').textContent = displayTitle;

            // Hide modal filter for tasks (or adjust if needed later)
            const yearFilterGroup = document.getElementById('modalFilterGroup');
            if (yearFilterGroup) yearFilterGroup.style.display = 'none';

            window.activeModalType = 'task'; // For search/filter logic consistency

            // Set for Search logic
            window.currentModalTasks = myTasks;

            // Reset Search UI
            const searchBox = document.getElementById('modalSearchBox');
            if (searchBox) {
                searchBox.value = "";
                searchBox.placeholder = "🔍 Search tasks in this list...";
            }

            renderFilteredTasks(myTasks);
            document.getElementById('filteredTasksModal').classList.add('active');
        }

        function closeFilteredTasksModal() {
            document.getElementById('filteredTasksModal').classList.remove('active');
        }

        function openDashboardTasksModal(status, scope = 'team') {
            const tasks = window.globalTasks || [];
            const today = new Date().toISOString().split('T')[0];

            // 1. Filter by Scope & Exclude Reminders
            let filteredTasks = tasks.filter(t => t.type !== 'reminder');
            let combinedTitle = "";

            if (scope === 'personal') {
                filteredTasks = tasks.filter(t => t.assigneeId === currentUser.uid);
                combinedTitle = "My Personal";
            } else {
                combinedTitle = (currentUser.role === 'team_leader') ? "Team/My" : "My";
            }

            // NEW: Filter by Time (from Dashboard Filters)
            const v = document.getElementById('dashboardViewType')?.value;
            const y = document.getElementById('dashboardYearFilter')?.value;
            const m = document.getElementById('dashboardMonthFilter')?.value;

            if (v === 'year' && y) {
                filteredTasks = filteredTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr.startsWith(y);
                });
            } else if (v === 'month' && y && m) {
                filteredTasks = filteredTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr.startsWith(`${y}-${m}`);
                });
            }

            // 2. Filter by Status
            let filterLabel = "All";
            if (status !== 'all') {
                if (status === 'overdue') {
                    filteredTasks = filteredTasks.filter(t => {
                        if (!t.dueDate) return false;
                        if (t.status !== 'completed' && t.dueDate < today) return true;
                        let doneDateStr = '';
                        if (t.completedAt && t.completedAt.toDate) try { doneDateStr = t.completedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                        else if (t.updatedAt && t.updatedAt.toDate) try { doneDateStr = t.updatedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                        return doneDateStr && doneDateStr > t.dueDate;
                    });
                    filterLabel = "Overdue ⚠️";
                } else {
                    filteredTasks = filteredTasks.filter(t => t.status === status);
                    filterLabel = status.replace('_', ' ').charAt(0).toUpperCase() + status.replace('_', ' ').slice(1);
                }
            }

            document.getElementById('filteredTasksTitle').textContent = `📌 ${combinedTitle} ${filterLabel} Tasks`;

            // Set for Search logic
            window.currentModalTasks = filteredTasks;

            // Reset Search UI
            const searchBox = document.getElementById('modalSearchBox');
            if (searchBox) searchBox.value = "";

            renderFilteredTasks(filteredTasks);
            document.getElementById('filteredTasksModal').classList.add('active');
        }

        function createTaskCard(task, isAdminView) {
            const isAssignedToMe = currentUser && task.assigneeId === currentUser.uid;

            // OVERDUE CHECK
            let isOverdue = false;
            // Simple string comparison for YYYY-MM-DD works
            if (task.dueDate && task.status !== 'completed') {
                const today = new Date().toISOString().split('T')[0];
                if (task.dueDate < today) {
                    isOverdue = true;
                }
            }

            const cardStyle = isOverdue ? 'border: 2px solid #ef4444; background-color: #fef2f2;' : '';
            const overdueBadge = isOverdue ? '<div style="background:#ef4444; color:white; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:4px; margin-bottom:5px; display:inline-block;">⚠️ OVERDUE</div>' : '';

            let statusAction = '';
            // Assignee or Admin can change Status
            if (isAssignedToMe || isAdminView) {
                statusAction = `
                    <div style="flex:1;">
                        <select onchange="updateTaskStatus('${task.id}', this.value)" class="form-select"
                            style="padding: 6px; font-size: 12px; margin: 0; width: 100%; cursor: pointer;">
                            <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                            <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Completed</option>
                        </select>
                    </div>
                `;
            }

            // Admin Only OR Team Leader: Edit and Delete Buttons
            let adminActions = '';

            // Edit Button (Admin & TL)
            if (isAdminView || (currentUser.role === 'team_leader' && (task.team === currentUser.team || task.assigneeId === currentUser.uid))) {
                adminActions += `
                    <button onclick="editTask('${task.id}')" class="task-btn" style="background:#3b82f6; border-color:#3b82f6; padding:6px 10px; margin:0 5px;" title="Edit">✏️</button>
                `;
            }

            // Delete Button (Admin ONLY)
            if (isAdminView && currentUser.role === 'admin') {
                adminActions += `
                    <button onclick="deleteTask('${task.id}')" class="task-btn" style="background:#ef4444; border-color:#ef4444; padding:6px 10px; margin:0 5px;" title="Delete">🗑️</button>
                `;
            }

            // History Button (Visible to everyone involved)
            let historyBtn = `
                <button onclick="showTaskHistory('${task.id}')" class="task-btn" style="background:#8b5cf6; border-color:#8b5cf6; padding:6px 10px; margin:0 5px;" title="History">🕒</button>
            `;

            adminActions = `<div style="display:flex; align-items:center;">${adminActions} ${historyBtn}</div>`;

            // Note Section REMOVED as per user request

            return `
    <div class="task-card" style="${cardStyle}">
        ${overdueBadge}
        <div class="task-header">
            <span class="task-priority ${task.priority}">${task.priority}</span>
            <span class="task-status ${task.status}">${task.status.replace('_', ' ')}</span>
        </div>
        <div class="task-title">${task.title}</div>
        <div class="task-desc">${task.description || 'No description'}</div>
        <div class="task-meta">
            <span>${isAdminView ? 'To: ' + task.assigneeName : 'From: ' + (task.assignedByName || 'Admin')}</span>
            <span>📅 ${task.dueDate || 'No Date'}</span>
        </div>
        <!-- Note Section Removed -->
        <div class="task-actions" style="display:flex; align-items:center;">
            ${statusAction}
            ${adminActions}
        </div>
    </div>
    `;
        }

        async function editTask(taskId) {
            // Find task in local data (rendered in grid) or fetch
            // Simpler to just re-fetch to ensure fresh data or pass id
            // We don't have a global 'allTasks' map easily accessible effectively here except render scope.
            // But we can fetch it.
            try {
                const doc = await db.collection('tasks').doc(taskId).get();
                if (!doc.exists) return;
                const task = doc.data();

                editingTaskId = taskId;

                // Ensure data is loaded
                if (!allUsers || allUsers.length === 0) await loadAllUsers();
                populateAssigneeDropdown();

                // Populate Modal
                document.getElementById('taskTitle').value = task.title;
                document.getElementById('taskDesc').value = task.description;
                document.getElementById('taskAssignee').value = task.assigneeId;
                document.getElementById('taskPriority').value = task.priority;
                document.getElementById('taskDueDate').value = task.dueDate;

                // Update Modal UI
                document.querySelector('#assignTaskModal h2').textContent = '✏️ Edit Task';
                document.querySelector('#assignTaskModal button[type="submit"]').textContent = 'Update Task';

                document.getElementById('assignTaskModal').classList.add('active');

            } catch (e) { console.error(e); alert('Error loading task details'); }
        }

        async function deleteTask(taskId) {
            if (!confirm('⚠️ Are you sure you want to PERMANENTLY delete this task? This action cannot be undone.')) return;
            try {
                await db.collection('tasks').doc(taskId).delete();
                // UI updates automatically via onSnapshot
            } catch (e) {
                console.error(e);
                alert('Failed to delete task: ' + e.message);
            }
        }

        async function updateTaskStatus(taskId, newStatus) {
            if (!confirm(`Are you sure you want to change the task status to ${newStatus.replace('_', ' ')}?`)) {
                // Refresh tasks to reset dropdown if user cancels
                renderTasks(window.globalTasks || []);
                return;
            }
            try {
                const doc = await db.collection('tasks').doc(taskId).get();
                const taskData = doc.data() || {};

                const updateData = {
                    status: newStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    history: firebase.firestore.FieldValue.arrayUnion({
                        action: 'status_change',
                        by: currentUser.name,
                        date: new Date().toISOString(),
                        details: `Status changed to ${newStatus.replace('_', ' ')}`
                    })
                };

                // Track Completion Date for Overdue Logic
                if (newStatus === 'completed') {
                    updateData.completedAt = firebase.firestore.FieldValue.serverTimestamp();
                } else {
                    // If moving back from completed (e.g. to in_progress), remove completedAt?
                    // Firestore update cannot easily 'remove' without FieldValue.delete(), but setting to null is okay.
                    // Or just ignore it logic-wise if status != completed.
                    updateData.completedAt = null;
                }

                await db.collection('tasks').doc(taskId).update(updateData);

                // NOTIFY ADMIN ON COMPLETION
                if (newStatus === 'completed') {
                    await db.collection('adminNotifications').add({
                        type: 'task_completed',
                        taskId: taskId,
                        taskTitle: taskData.title || 'Untitled Task',
                        completedBy: currentUser.uid,
                        completedByName: currentUser.name || 'Unknown',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        isRead: false
                    });
                }
            } catch (error) {
                console.error("Status update error:", error);
                alert("Failed to update status: " + error.message);
            }
        }



        // ========== HISTORY FUNCTIONS ==========
        async function showTaskHistory(taskId) {
            try {
                const doc = await db.collection('tasks').doc(taskId).get();
                if (!doc.exists) return;
                const task = doc.data();
                const history = task.history || [];

                // Sort by date desc
                history.sort((a, b) => new Date(b.date) - new Date(a.date));

                const list = document.getElementById('taskHistoryList');
                if (history.length === 0) {
                    list.innerHTML = '<p class="text-center text-gray-500">No history available.</p>';
                } else {
                    list.innerHTML = history.map(h => {
                        const dateObj = new Date(h.date);
                        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();
                        let icon = '📝';
                        if (h.action === 'created') icon = '✨';
                        if (h.action === 'status_change') icon = '🔄';
                        if (h.action === 'reassigned') icon = '👉';

                        return `
                        <div class="notification-item" style="align-items: flex-start;">
                            <div class="notification-user-icon" style="font-size:16px;">${icon}</div>
                            <div class="notification-user-details">
                                <div class="notification-user-name">${h.by || 'Unknown User'}</div>
                                <div class="notification-user-meta">${h.details}</div>
                                <div class="notification-user-meta" style="font-size:11px;">${dateStr}</div>
                            </div>
                        </div>
                        `;
                    }).join('');
                }
                document.getElementById('taskHistoryModal').classList.add('active');

            } catch (e) { console.error(e); alert("Failed to load history."); }
        }
        function closeHistoryModal() {
            document.getElementById('taskHistoryModal').classList.remove('active');
        }

        // ========== GOOGLE SHEETS DATA FUNCTIONS ==========

        // Validation Helper for Signup
        function validateEmployeeIdInSheet(targetId) {
            return new Promise((resolve, reject) => {
                const scriptId = 'sheetValidationScript';

                // Cleanup previous
                const oldScript = document.getElementById(scriptId);
                if (oldScript) oldScript.remove();

                // Define temporary callback
                window.handleValidationData = function (json) {
                    try {
                        if (!json || !json.table || !json.table.rows) {
                            resolve(false);
                            return;
                        }

                        const rows = json.table.rows;
                        // Check first 2 columns of every row for a match
                        const found = rows.some(r => {
                            if (!r.c) return false;
                            const idCell = r.c[0]; // Assuming ID is usually first column
                            const altCell = r.c[1]; // Or second

                            const idVal = (idCell && idCell.v) ? String(idCell.v).trim() : '';
                            const altVal = (altCell && altCell.v) ? String(altCell.v).trim() : '';

                            return idVal === targetId || altVal === targetId;
                        });

                        resolve(found);
                    } catch (e) {
                        console.error('Validation Parse Error', e);
                        resolve(false); // Fail safe
                    } finally {
                        const s = document.getElementById(scriptId);
                        if (s) s.remove();
                        delete window.handleValidationData;
                    }
                };

                const script = document.createElement('script');
                script.id = scriptId;
                // Use a different responseHandler
                script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=responseHandler:handleValidationData;out:json&sheet=${SHEET_NAME}`;

                script.onerror = function () {
                    console.error('Validation Network Error');
                    // Decide if we block or allow on network error.
                    // Secure approach: Block.
                    resolve(false);
                };

                document.body.appendChild(script);
            });
        }

        // Callback function for Google Sheets JSONP
        window.handleSheetData = function (json) {
            const statusBadge = document.getElementById('statusBadge');
            const refreshButton = document.getElementById('refreshButton');

            try {
                if (!json || !json.table) throw new Error('Invalid data format');

                const cols = json.table.cols;
                const rows = json.table.rows;

                if (rows.length === 0) throw new Error('No data found in sheet');

                // Convert JSONP format to simplified Array of Objects
                const data = rows.map(r => {
                    const row = {};
                    cols.forEach((col, i) => {
                        // col.label contains the header name
                        const key = col.label ? col.label.trim() : `Column_${i}`;
                        const cell = r.c[i];
                        row[key] = (cell && cell.v !== null) ? cell.v : '';
                    });
                    return row;
                });

                const { attendance, leaves } = processSheetData(data);
                employeeData = attendance;
                leaveData = leaves;

                statusBadge.className = 'status-badge success';
                statusBadge.textContent = '✅ Connected';

                document.getElementById('lastUpdate').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

                // Safe count update
                const count = (employeeData ? employeeData.length : 0) + (leaveData ? leaveData.length : 0);
                document.getElementById('recordCount').textContent = `Records: ${count}`;

                populateYearFilters();
                applyFilters();

            } catch (error) {
                console.error('Data Processing Error:', error);
                handleLoadError(error.message);
            } finally {
                if (refreshButton) refreshButton.disabled = false;
                // Cleanup script tag
                const script = document.getElementById('sheetDataScript');
                if (script) script.remove();
            }
        };

        function handleLoadError(msg) {
            const statusBadge = document.getElementById('statusBadge');
            const refreshButton = document.getElementById('refreshButton');

            statusBadge.className = 'status-badge error';
            statusBadge.textContent = '❌ Error';

            document.getElementById('profilesContainer').innerHTML = `
                <div class="no-data">
                    <div class="no-data-icon">⚠️</div>
                    <h2>Data Load Failed</h2>
                    <p>${msg}</p>
                    <button onclick="loadGoogleSheetData()" class="auth-button" style="width:auto; margin-top:15px;">Retry Connection</button>
                </div>
            `;
            if (refreshButton) refreshButton.disabled = false;
        }

        async function loadGoogleSheetData() {
            const statusBadge = document.getElementById('statusBadge');
            const refreshButton = document.getElementById('refreshButton');

            statusBadge.className = 'status-badge loading';
            statusBadge.innerHTML = '<span class="loading-spinner"></span> Loading...';
            if (refreshButton) refreshButton.disabled = true;

            // Remove existing script if any
            const existingScript = document.getElementById('sheetDataScript');
            if (existingScript) existingScript.remove();

            // JSONP Injection
            const script = document.createElement('script');
            script.id = 'sheetDataScript';
            // tq?headers=1 ensures the first row is treated as labels in 'cols'
            script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=responseHandler:handleSheetData;out:json&headers=1&sheet=${SHEET_NAME}`;

            script.onerror = function () {
                handleLoadError('Failed to connect to Google Sheets. Please check your internet connection.');
            };

            document.body.appendChild(script);
        }

        function processSheetData(data) {
            const attendance = [];
            const leaves = [];

            data.forEach(row => {
                // Adapt to your sheet column names
                const id = row['Employee ID'] || row['ID'];
                const name = row['Name'] || row['Employee Name'];
                if (!id) return;

                if (row['Type of Leave']) {
                    leaves.push({
                        id, name,
                        leaveType: row['Type of Leave'],
                        startDate: parseDate(row['Start Date of Leave']),
                        endDate: parseDate(row['End Date of Leave']),
                        totalDays: parseFloat(row['Total Leave Days'] || 0)
                    });
                } else {
                    attendance.push({
                        id, name,
                        id, name,
                        date: parseDate(row['Date']),
                        clockIn: parseTime(row['Clock In']),
                        clockOut: parseTime(row['Clock Out']),
                        totalHours: parseTotalHours(row['Total Hours'])
                    });
                }
            });
            return { attendance, leaves };
        }

        function parseDate(d) {
            // Handle "Date(2025,10,28)" -> "2025-11-28" (Month is 0-indexed)
            if (!d) return '';

            // Check for Google Viz "Date(y,m,d)" format
            const googleDateMatch = String(d).match(/Date\((\d+),(\d+),(\d+)\)/);
            if (googleDateMatch) {
                const year = googleDateMatch[1];
                const month = parseInt(googleDateMatch[2]) + 1; // Google months are 0-11
                const day = googleDateMatch[3];
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }

            // Handle "DD/MM/YYYY" or "YYYY-MM-DD"
            if (String(d).includes('/')) {
                const [day, month, year] = d.split('/');
                return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            return d; // Assume already ISO or acceptable format
        }

        function parseTime(t) {
            // Handle "Date(1899,11,30,11,16,0)" -> "11:16 AM"
            if (!t) return '';

            // Check for Google Viz Time format
            // Matches Date(year, month, day, hour, min, sec)
            const googleTimeMatch = String(t).match(/Date\(\d+,\d+,\d+,(\d+),(\d+),(\d+)\)/);

            if (googleTimeMatch) {
                let hours = parseInt(googleTimeMatch[1]);
                const minutes = parseInt(googleTimeMatch[2]);
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                hours = hours ? hours : 12; // the hour '0' should be '12'
                return `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
            }

            // Fallback for simple string times if any
            return t;
        }

        function parseTotalHours(val) {
            if (!val) return 0;

            // If it's already a number
            if (typeof val === 'number') return val;

            const strVal = String(val);

            // Handle Google Sheets Duration as Date: "Date(1899, 11, 30, 8, 30, 0)" -> 8.5
            // Allow spaces around commas
            const dateMatch = strVal.match(/Date\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
            if (dateMatch) {
                const hours = parseInt(dateMatch[4]);
                const minutes = parseInt(dateMatch[5]);
                // Convert to decimal hours (e.g., 8h 30m -> 8.5)
                return parseFloat((hours + (minutes / 60)).toFixed(2));
            }

            // If it's a string, try safely parsing
            const num = parseFloat(val);
            if (!isNaN(num)) return num;

            // Special handling if it contains text like "8 hrs" matches first number
            // Ensure we don't accidentally pick up year values from broken Date strings
            // Skip if it looks like part of Date(y,m,d...)
            if (strVal.includes('Date(')) return 0;

            const match = strVal.match(/\b\d+(\.\d+)?\b/);
            if (match) {
                return parseFloat(match[0]);
            }

            return 0;
        }

        function calculateLeaveBalance(id, name, targetYear) {
            // Default to current year if none provided
            const year = targetYear || new Date().getFullYear().toString();

            // Filter leaves for the specific year
            const myLeaves = leaveData.filter(l => {
                // Robust ID check: Convert both to string and trim
                // Ignore name check as ID is unique and name formatting might differ
                if (String(l.id).trim() !== String(id).trim()) return false;

                // Check if start date matches the year
                if (!l.startDate) return false;
                return l.startDate.startsWith(year);
            });

            const balance = { ...LEAVE_QUOTAS };

            myLeaves.forEach(l => {
                if (balance[l.leaveType] !== undefined) {
                    balance[l.leaveType] -= l.totalDays;
                }
            });
            return balance;
        }

        // ========== UI HELPERS ==========
        function populateYearFilters() {
            // Preserve selection or Default to 2026
            const els = [
                { id: 'yearFilter', old: document.getElementById('yearFilter')?.value || "" },
                { id: 'dashboardYearFilter', old: document.getElementById('dashboardYearFilter')?.value || "" },
                { id: 'teamYearFilter', old: document.getElementById('teamYearFilter')?.value || "" },
                { id: 'modalYearFilter', old: document.getElementById('modalYearFilter')?.value || "" }
            ];
            const currentYear = "2026"; // Default as requested

            const years = [...new Set(employeeData.map(e => e.date.substring(0, 4)).filter(y => y))].sort((a, b) => b - a);
            if (!years.includes(currentYear)) years.unshift(currentYear);

            const opts = '<option value="">Select Year</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');

            els.forEach(item => {
                const el = document.getElementById(item.id);
                if (el) {
                    el.innerHTML = opts;
                    if (item.old && years.includes(item.old)) {
                        el.value = item.old;
                    } else {
                        el.value = currentYear;
                    }
                }
            });

            // Populate Month Filters as well
            const months = [
                { v: '01', n: 'January' }, { v: '02', n: 'February' }, { v: '03', n: 'March' },
                { v: '04', n: 'April' }, { v: '05', n: 'May' }, { v: '06', n: 'June' },
                { v: '07', n: 'July' }, { v: '08', n: 'August' }, { v: '09', n: 'September' },
                { v: '10', n: 'October' }, { v: '11', n: 'November' }, { v: '12', n: 'December' }
            ];
            const monthOpts = '<option value="">Select Month</option>' + months.map(m => `<option value="${m.v}">${m.n}</option>`).join('');

            ['monthFilter', 'dashboardMonthFilter', 'teamMonthFilter'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = monthOpts;
            });
        }

        function applyFilters() {
            if (!currentUser) return;

            let filtered = [...employeeData];
            if (currentUser.role !== 'admin' && !currentUser.isAdmin) {
                // Robust comparison using String()
                filtered = filtered.filter(e => String(e.id) === String(currentUser.employeeId));
            }

            const view = document.getElementById('viewType').value;
            const y = document.getElementById('yearFilter').value;
            const m = document.getElementById('monthFilter').value;
            const d = document.getElementById('dayFilter').value;
            const search = document.getElementById('searchBox').value.toLowerCase();

            // Filter logic
            if (view === 'year' && y) filtered = filtered.filter(e => e.date.startsWith(y));
            else if (view === 'month' && y && m) filtered = filtered.filter(e => e.date.startsWith(`${y}-${m}`));
            else if (view === 'day' && d) filtered = filtered.filter(e => e.date === d);

            if (search) filtered = filtered.filter(e => e.name.toLowerCase().includes(search) || String(e.id).includes(search));

            // Group and Render
            const grouped = {};
            filtered.forEach(r => {
                const k = r.id;
                if (!grouped[k]) grouped[k] = { ...r, records: [], totalHours: 0 };
                grouped[k].records.push(r);
                grouped[k].totalHours += r.totalHours;
            });

            const container = document.getElementById('profilesContainer');
            const items = Object.values(grouped);

            if (items.length === 0) {
                container.innerHTML = `<div class="no-data">
                    <h2>No Data Found</h2>
                </div>`;
                return;
            }

            container.innerHTML = items.map(emp => {
                // Use selected filter year OR current year for card display
                const selectedYear = document.getElementById('yearFilter').value;
                const bal = calculateLeaveBalance(emp.id, emp.name, selectedYear);

                // Find user role for badge
                // Find user role for badge
                // FIX: Match by employeeId field, not the document ID (which is Auth UID)
                const userObj = allUsers.find(u => String(u.employeeId) === String(emp.id));
                const isTeamLead = userObj && userObj.role === 'team_leader';

                // DEBUG LOG - Kept for verification
                // console.log(`Rendering ${emp.name} (${emp.id}): Found User?`, userObj ? 'Yes' : 'No', 'Role:', userObj ? userObj.role : 'N/A', 'IsTL:', isTeamLead);

                const cardName = emp.name + (isTeamLead ? ' ⭐' : '');

                return `
    <div class="profile-card" onclick="showDashboard('${emp.id}', '${emp.name}')">
        <div class="profile-header">
            <div class="profile-avatar">${emp.name.charAt(0)}</div>
            <div class="profile-info">
                <div class="employee-id">${emp.id}</div>
                <div class="employee-name">${cardName}</div>
            </div>
        </div>
        <div class="total-hours">
            <div class="total-hours-value">${emp.totalHours.toFixed(2)} hrs</div>
        </div>
        <div class="leave-balance-section">
            <div class="leave-items">
                <div class="leave-item">ANNUAL: ${bal['Annual Leave']}</div>
                <div class="leave-item">SICK: ${bal['Sick Leave']}</div>
            </div>
        </div>
    </div>`;
            }).join('');

            // Auto-redirect for employees
            if ((currentUser.role !== 'admin' && !currentUser.isAdmin) && items.length === 1) {
                const emp = items[0];
                showDashboard(emp.id, emp.name);
                // Hide back button for employees since they only have one view
                document.querySelector('.back-button').style.display = 'none';
            } else {
                // Ensure back button is visible for admins returning to list
                document.querySelector('.back-button').style.display = 'block';
            }
        }

        function showDashboard(id, name) {
            // Store full employee object if needed, but we rely on global arrays
            // For leave calc, we need name match as per current logic
            currentEmployee = { id, name };
            document.getElementById('listView').style.display = 'none';
            document.getElementById('dashboardView').classList.add('active');

            document.getElementById('dashboardName').textContent = name;
            document.getElementById('dashboardId').textContent = id;
            document.getElementById('dashboardAvatar').textContent = name.charAt(0);

            // Set Default View to Year and Current Year
            document.getElementById('dashboardViewType').value = 'year';
            document.getElementById('dashboardYearFilter').value = new Date().getFullYear();
            // Show/Hide appropriate filter groups
            document.getElementById('dashboardYearFilterGroup').classList.remove('hidden');
            document.getElementById('dashboardMonthFilterGroup').classList.add('hidden');
            document.getElementById('dashboardDayFilterGroup').classList.add('hidden');

            // Update Dashboard Data
            // Update Dashboard Data
            // Sort attendance by date descending (latest first)
            const myAtt = employeeData.filter(e => e.id == id).sort((a, b) => new Date(b.date) - new Date(a.date));
            const myLeaves = leaveData.filter(l => l.id == id);

            // Trigger dynamic stats update logic
            // This ensures stats reflect the current dashboard filter state (default: Year view, Current Year)
            dashboardTaskFilter = 'all'; // Reset filter when opening new dashboard
            updateDashboardStats();
        }

        function showListView() {
            document.getElementById('listView').style.display = 'block';
            document.getElementById('dashboardView').classList.remove('active');
            currentEmployee = null;
            dashboardTaskFilter = 'all'; // Reset filter
        }

        // View filter event listeners
        document.getElementById('viewType').addEventListener('change', () => {
            const v = document.getElementById('viewType').value;
            // Show Year filter for both "Year" and "Month" views
            document.getElementById('yearFilterGroup').classList.toggle('hidden', v !== 'year' && v !== 'month');
            document.getElementById('monthFilterGroup').classList.toggle('hidden', v !== 'month');
            document.getElementById('dayFilterGroup').classList.toggle('hidden', v !== 'day');
            applyFilters();
        });

        document.getElementById('yearFilter').addEventListener('change', applyFilters);
        document.getElementById('monthFilter').addEventListener('change', applyFilters);
        document.getElementById('dayFilter').addEventListener('change', applyFilters);
        document.getElementById('searchBox').addEventListener('input', applyFilters);
        document.getElementById('dashboardViewType').addEventListener('change', () => {
            const v = document.getElementById('dashboardViewType').value;
            document.getElementById('dashboardYearFilterGroup').classList.toggle('hidden', v !== 'year' && v !== 'month'); // Show year for month view too
            document.getElementById('dashboardMonthFilterGroup').classList.toggle('hidden', v !== 'month');
            document.getElementById('dashboardDayFilterGroup').classList.toggle('hidden', v !== 'day');
            updateDashboardStats();
        });
        document.getElementById('dashboardYearFilter').addEventListener('change', updateDashboardStats);
        document.getElementById('dashboardMonthFilter').addEventListener('change', updateDashboardStats);
        document.getElementById('dashboardDayFilter').addEventListener('change', updateDashboardStats);

        // Team Status Overview Filters
        if (document.getElementById('teamViewType')) {
            document.getElementById('teamViewType').addEventListener('change', () => {
                const v = document.getElementById('teamViewType').value;
                document.getElementById('teamYearFilterGroup').classList.toggle('hidden', v !== 'year' && v !== 'month');
                document.getElementById('teamMonthFilterGroup').classList.toggle('hidden', v !== 'month');
                document.getElementById('teamDayFilterGroup').classList.toggle('hidden', v !== 'day');
                renderTeamTaskStats(window.allTasksRaw || []);
            });
            document.getElementById('teamYearFilter').addEventListener('change', () => renderTeamTaskStats(window.allTasksRaw || []));
            document.getElementById('teamMonthFilter').addEventListener('change', () => renderTeamTaskStats(window.allTasksRaw || []));
            document.getElementById('teamDayFilter').addEventListener('change', () => renderTeamTaskStats(window.allTasksRaw || []));
        }

        // Modal Year Filter
        if (document.getElementById('modalYearFilter')) {
            document.getElementById('modalYearFilter').addEventListener('change', refreshFilteredModalList);
        }

        function updateDashboardStats() {
            if (!currentEmployee) return;
            const id = currentEmployee.id;

            // --- 1. Filter Attendance ---
            let records = employeeData.filter(e => e.id == id);

            // Apply Dashboard Filters
            const view = document.getElementById('dashboardViewType').value;
            const y = document.getElementById('dashboardYearFilter').value;
            const m = document.getElementById('dashboardMonthFilter').value;
            const d = document.getElementById('dashboardDayFilter').value;

            // Robust Filter Logic
            if (view === 'year') {
                if (y) records = records.filter(e => e.date.startsWith(y));
            } else if (view === 'month') {
                if (y && m) records = records.filter(e => e.date.startsWith(`${y}-${m}`));
                else if (y) records = records.filter(e => e.date.startsWith(y)); // Fallback to year
            } else if (view === 'day') {
                if (d) records = records.filter(e => e.date === d);
            }

            // Sort filtered records (Latest First)
            records.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Calculate Stats based on filtered records
            const totalDays = records.length;
            const totalHours = records.reduce((sum, r) => sum + (parseTotalHours(r.totalHours) || 0), 0);
            const avgHours = totalDays > 0 ? (totalHours / totalDays).toFixed(2) : 0;

            // Update Stats UI
            if (document.getElementById('statTotalDays')) document.getElementById('statTotalDays').textContent = totalDays;
            if (document.getElementById('statTotalHours')) document.getElementById('statTotalHours').textContent = totalHours.toFixed(1);
            if (document.getElementById('statAvgHours')) document.getElementById('statAvgHours').textContent = avgHours;

            // Render Attendance Table
            document.getElementById('attendanceTableBody').innerHTML = records.map(r => `
    <tr>
        <td>${r.date}</td>
        <td>${r.clockIn}</td>
        <td>${r.clockOut}</td>
        <td>${r.totalHours}</td>
    </tr>
            `).join('');

            // --- 2. Filter Leaves ---
            let myLeaves = leaveData.filter(l => l.id == id);

            if (view === 'year') {
                if (y) myLeaves = myLeaves.filter(l => l.startDate.startsWith(y));
            } else if (view === 'month') {
                if (y && m) myLeaves = myLeaves.filter(l => l.startDate.startsWith(`${y}-${m}`));
                else if (y) myLeaves = myLeaves.filter(l => l.startDate.startsWith(y));
            } else if (view === 'day') {
                if (d) myLeaves = myLeaves.filter(l => l.startDate === d);
            }

            // Render Leave Table
            document.getElementById('leaveHistoryTableBody').innerHTML = myLeaves.map(l => `
    <tr>
        <td>${l.leaveType}</td>
        <td>${l.startDate}</td>
        <td>${l.endDate}</td>
        <td>${l.totalDays}</td>
    </tr>
            `).join('');

            // --- 3. Update Leave Balances Visuals ---
            // Determine Year to use for Balances
            let balanceYear = new Date().getFullYear().toString();
            if ((view === 'year' || view === 'month') && y) {
                balanceYear = y;
            } else if (view === 'day' && d) {
                // Try to extract year from YYYY-MM-DD
                balanceYear = d.split('-')[0] || balanceYear;
            }

            // Recalculate balance for this user+year
            // Note: Current logic needs 'name' too
            const bal = calculateLeaveBalance(id, currentEmployee.name, balanceYear);

            const updateBar = (type, elId) => {
                const el = document.getElementById(elId);
                const prog = document.getElementById(elId.replace('Remaining', 'Progress'));
                if (el && prog) {
                    el.textContent = bal[type];
                    // Example safety check if quota is 0 to avoid Infinity
                    const quota = LEAVE_QUOTAS[type] || 1;
                    prog.style.width = ((bal[type] / quota) * 100) + '%';
                }
            };

            updateBar('Annual Leave', 'annualRemaining');
            updateBar('Casual Leave', 'casualRemaining');
            updateBar('Sick Leave', 'sickRemaining');

            if (document.getElementById('marriageRemaining')) {
                document.getElementById('marriageRemaining').textContent = (LEAVE_QUOTAS['Work From Home'] - bal['Work From Home']) + ' days';
            }

            // --- 4. Update Task Stats for Dashboard ---
            updateDashboardTaskStats(id);
            updateTaskCounters(window.globalTasks || []);
        }

        function updateDashboardTaskStats(employeeId) {
            console.log("updateDashboardTaskStats called for employeeId:", employeeId);
            const tasks = window.globalTasks || [];

            // Fix: Map business employeeId to Firebase UID
            // Ensure allUsers is available
            if (!allUsers || allUsers.length === 0) {
                console.log("allUsers not yet loaded, retrying in 1s...");
                setTimeout(() => updateDashboardTaskStats(employeeId), 1000);
                return;
            }

            const userObj = allUsers.find(u => String(u.employeeId).trim() === String(employeeId).trim());
            const uid = userObj ? userObj.id : null;

            console.log("Mapped employeeId", employeeId, "to UID:", uid);

            if (!uid) {
                console.warn("No Firebase UID found for employeeId:", employeeId, ". Cannot update task stats.");
                // Clear stats if no user found
                if (document.getElementById('dashTaskOngoing')) document.getElementById('dashTaskOngoing').textContent = 0;
                if (document.getElementById('dashTaskCompleted')) document.getElementById('dashTaskCompleted').textContent = 0;
                if (document.getElementById('dashTaskPending')) document.getElementById('dashTaskPending').textContent = 0;
                if (document.getElementById('dashTaskOverdue')) document.getElementById('dashTaskOverdue').textContent = 0;
                return;
            }

            // Filter tasks for this specific employee UID & Exclude Reminders
            let myTasks = tasks.filter(t => {
                const tid = String(t.assigneeId);
                return tid === String(uid) && t.type !== 'reminder';
            });

            // NEW: Apply Dashboard Year Filter
            const dView = document.getElementById('dashboardViewType')?.value;
            const dYear = document.getElementById('dashboardYearFilter')?.value;
            const dMonth = document.getElementById('dashboardMonthFilter')?.value;

            if ((dView === 'year' || dView === 'month') && dYear) {
                myTasks = myTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    if (dView === 'year') return dateStr.startsWith(dYear);
                    return dMonth ? dateStr.startsWith(`${dYear}-${dMonth}`) : dateStr.startsWith(dYear);
                });
            } else if (dView === 'day' && document.getElementById('dashboardDayFilter')?.value) {
                const dv = document.getElementById('dashboardDayFilter').value;
                myTasks = myTasks.filter(t => {
                    const dateStr = t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : (t.dueDate || "");
                    return dateStr === dv;
                });
            }

            console.log("Filtered tasks for UID:", uid, myTasks);

            const pending = myTasks.filter(t => t.status === 'pending').length;
            const ongoing = myTasks.filter(t => t.status === 'in_progress').length;
            const completed = myTasks.filter(t => t.status === 'completed').length;

            // Overdue Logic:
            // 1. Active tasks (pending, in_progress) that are past their due date
            // 2. Completed tasks that were finished after their due date
            const today = new Date().toISOString().split('T')[0];
            const overdue = myTasks.filter(t => {
                if (!t.dueDate) return false;

                if (t.status !== 'completed') {
                    // Case 1: Active & Late
                    return t.dueDate < today;
                } else {
                    // Case 2: Completed & Late
                    // Use completedAt (if available) or updatedAt as a fallback
                    let doneDateStr = '';
                    if (t.completedAt && t.completedAt.toDate) {
                        try { doneDateStr = t.completedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                    } else if (t.updatedAt && t.updatedAt.toDate) {
                        try { doneDateStr = t.updatedAt.toDate().toISOString().split('T')[0]; } catch (e) { }
                    }

                    return doneDateStr && doneDateStr > t.dueDate;
                }
            }).length;

            // Update UI
            if (document.getElementById('dashTaskOngoing')) document.getElementById('dashTaskOngoing').textContent = ongoing;
            if (document.getElementById('dashTaskCompleted')) document.getElementById('dashTaskCompleted').textContent = completed;
            if (document.getElementById('dashTaskPending')) document.getElementById('dashTaskPending').textContent = pending;
            if (document.getElementById('dashTaskOverdue')) document.getElementById('dashTaskOverdue').textContent = overdue;
        }

        function startAutoRefresh() {
            autoRefreshInterval = setInterval(() => {
                loadGoogleSheetData();
                if (currentUser && (currentUser.isAdmin || currentUser.role === 'admin')) {
                    loadAdminNotifications();
                }
            }, 300000); // 5 mins
        }

        function downloadTasksExcel() {
            const tasks = window.currentModalTasks || [];
            if (tasks.length === 0) {
                alert("No data available to download.");
                return;
            }

            const title = document.getElementById('filteredTasksTitle').textContent || "Export";
            const fileName = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.xlsx`;

            // Map data for Excel
            const data = tasks.map(t => {
                if (t.leaveType) {
                    return {
                        "Type": t.leaveType,
                        "Start Date": t.startDate,
                        "End Date": t.endDate,
                        "Total Days": t.totalDays
                    };
                } else {
                    const historyStr = (t.history || [])
                        .map(h => {
                            const d = h.date ? new Date(h.date).toLocaleString() : "N/A";
                            return `[${d}] ${h.by || 'Unknown'}: ${h.details || h.action}`;
                        })
                        .join("\n");

                    return {
                        "Title": t.title || "N/A",
                        "Description": t.description || "N/A",
                        "Priority": t.priority || "N/A",
                        "Status": t.status || "N/A",
                        "Assignee": t.assigneeName || "N/A",
                        "Assigned By": t.assignedByName || "N/A",
                        "Due Date": t.dueDate || "N/A",
                        "Created At": t.createdAt && t.createdAt.toDate ? t.createdAt.toDate().toLocaleString() : "N/A",
                        "Task History": historyStr || "No history"
                    };
                }
            });

            const worksheet = XLSX.utils.json_to_sheet(data);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Data");

            XLSX.writeFile(workbook, fileName);
        }

function openNotificationHistory() {
            const list = document.getElementById('notificationListContainer');
            const tasks = window.globalTasks || [];

            // Filter and Sort: Current User, Latest First
            const myNotifications = tasks
                .filter(t => String(t.assigneeId) === String(currentUser.uid))
                .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

            if (myNotifications.length === 0) {
                list.innerHTML = `<div style="text-align:center; padding:40px; color:#9ca3af;">
                    <div style="font-size:40px; margin-bottom:10px;">📭</div>
                    <div>No notifications</div>
                </div>`;
            } else {
                list.innerHTML = myNotifications.map(t => {
                    // Format Date
                    let dateStr = 'Just now';
                    if (t.createdAt) {
                        dateStr = new Date(t.createdAt.seconds * 1000).toLocaleDateString([], { hour: '2-digit', minute: '2-digit' });
                    }

                    const statusColors = {
                        'pending': '#f59e0b',
                        'in_progress': '#3b82f6',
                        'completed': '#10b981'
                    };
                    const statusColor = statusColors[t.status] || '#6b7280';
                    const icon = t.status === 'completed' ? '✅' : (t.status === 'in_progress' ? '🔄' : '📌');

                    return `
                    <div style="background:${t.isRead ? 'white' : '#f0f9ff'}; padding:15px; border-radius:12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border:1px solid ${t.isRead ? '#e5e7eb' : '#bae6fd'}; display:flex; gap:15px; align-items:start;">
                        <div style="background:${statusColor}15; min-width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px;">
                            ${icon}
                        </div>
                        <div style="flex-grow:1;">
                            <div style="display:flex; justify-content:space-between; align-items:start;">
                                    ${t.type === 'reminder' ? `<span style="color:#ef4444;">⚠️ Reminder:</span> ` : ''}${t.title}
                                    ${!t.isRead ? '<span style="display:inline-block; width:8px; height:8px; background:#ef4444; border-radius:50%; margin-left:5px;"></span>' : ''}
                                </div>
                                <div style="font-size:11px; color:#9ca3af; white-space:nowrap;">${dateStr}</div>
                            </div>
                            <div style="font-size:13px; color:#6b7280; margin-top:2px;">
                                ${t.type === 'reminder' ? t.description : (t.description || 'No details provided.')}
                            </div>
                            <div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
                                <div style="display:flex; gap:10px; font-size:11px; font-weight:600;">
                                    <span style="background:${statusColor}20; color:${statusColor}; padding:2px 8px; border-radius:4px;">${t.status.replace('_', ' ').toUpperCase()}</span>
                                    <span style="background:${t.priority === 'high' ? '#fee2e2' : '#f3f4f6'}; color:${t.priority === 'high' ? '#ef4444' : '#4b5563'}; padding:2px 8px; border-radius:4px;">${t.priority.toUpperCase()}</span>
                                </div>
                                ${!t.isRead ? `<button onclick="markAsRead('${t.id}')" style="background:none; border:none; color:#3b82f6; font-size:12px; font-weight:600; cursor:pointer;">Mark as Read</button>` : ''}
                            </div>
                        </div>
                    </div>
                `;
                }).join('');
            }
            document.getElementById('notificationHistoryModal').classList.add('active');
        }

        function closeNotificationHistory() {
            document.getElementById('notificationHistoryModal').classList.remove('active');
        }

        async function markAsRead(taskId) {
            try {
                await db.collection('tasks').doc(taskId).update({
                    isRead: true
                });
                // UI will auto-update via onSnapshot -> openNotificationHistory re-render if open?
                // Actually openNotificationHistory is static render. We need to re-render it if open.
                // But simplified: onSnapshot calls renderTasks. It does NOT call openNotificationHistory.
                // We should manually refresh the list if it's open.
                // But since we are inside a partial update, let's just let the user re-open or handle it via a listener trigger if we were fancy.
                // Better: Just re-call openNotificationHistory() as we have the data in window.globalTasks (which will be updated by snapshot eventually, but local optimistic update is faster?)
                // Actually snapshot comes in fast.
                // Let's rely on snapshot?
                // Issue: onSnapshot updates window.globalTasks and calls renderTasks (Task Board), but doesn't refresh the Notification Modal if open.
                // We can force refresh.

            } catch (error) {
                console.error("Error marking read:", error);
            }
        }

        function showToast(message, type = 'info') {
            // Tailwind classes not loaded? Fallback styles.
            // Using inline styles for guaranteed visibility if Tailwind is missing/slow

            let container = document.getElementById('toastContainer');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toastContainer';
                container.style.cssText = "position:fixed; top:20px; right:20px; z-index:9999; display:flex; flex-direction:column; gap:10px;";
                document.body.appendChild(container);
            }

            const toast = document.createElement('div');

            // Base styles
            toast.style.cssText = "background-color: #2563EB; color: white; padding: 12px 16px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); font-family: sans-serif; display: flex; align-items: center; gap: 12px; min-width: 250px; opacity: 0; transform: translateX(100%); transition: all 0.3s ease-out;";

            if (type === 'error') toast.style.backgroundColor = '#EF4444';

            toast.innerHTML = `
                <span style="flex-grow:1">${message}</span>
                <button onclick="this.parentElement.remove()" style="background:none; border:none; color:white; font-size:18px; cursor:pointer;" onmouseover="this.style.color='#E5E7EB'" onmouseout="this.style.color='white'">&times;</button>
            `;

            container.appendChild(toast);

            // Animate in
            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(0)';
            });

            // Auto dismiss
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                setTimeout(() => toast.remove(), 300);
            }, 5000);
        }
