// ==========================================
// WIFE CONNECT KENYA ADMIN DASHBOARD
// ==========================================

const API = '/api/admin';

const $ = (id) => document.getElementById(id);


// ==========================================
// API REQUEST HELPER
// ==========================================

async function apiRequest(url, options = {}) {

    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
        window.location.href = '/admin/login.html';
        throw new Error('Your session has expired.');
    }

    if (!response.ok) {
        throw new Error(
            data.error || 'Request failed.'
        );
    }

    return data;
}


// ==========================================
// ADMIN SESSION
// ==========================================

async function loadAdminProfile() {

    const admin = await apiRequest(`${API}/me`);

    $('sidebarName').textContent = admin.full_name;

    $('profileDisplayName').textContent = admin.full_name;

    $('fullName').value = admin.full_name;

    $('profileEmail').value = admin.email;

    $('profilePhone').value = admin.phone || '';

    $('sidebarAvatar').textContent =
        admin.full_name.charAt(0).toUpperCase();

    $('topAvatar').textContent =
        admin.full_name.charAt(0).toUpperCase();

    if (admin.has_image) {

        const image = `${API}/profile-picture?t=${Date.now()}`;

        $('profileImage').src = image;

        $('sidebarAvatar').style.backgroundImage =
            `url("${image}")`;

        $('sidebarAvatar').style.backgroundSize = 'cover';

        $('sidebarAvatar').textContent = '';

        $('topAvatar').style.backgroundImage =
            `url("${image}")`;

        $('topAvatar').style.backgroundSize = 'cover';

        $('topAvatar').textContent = '';

    }

}


// ==========================================
// DASHBOARD OVERVIEW
// ==========================================

async function loadOverview() {

    const data = await apiRequest(`${API}/overview`);

    $('totalAdmins').textContent =
        data.administratorCount ?? 2;

    $('totalRevenue').textContent =
        'KES 0';

    $('pendingPayments').textContent =
        data.transactions?.pending ?? 0;

    $('activeSubscriptions').textContent =
        data.subscriptions?.active ?? 0;

    $('dashboardNotice').textContent =
        data.notice || 'Dashboard information loaded.';

    // Administrator records

    const adminTable = $('adminTable');

    adminTable.innerHTML = '';

    data.administrators.forEach(admin => {

        const row = document.createElement('tr');

        [
            admin.full_name,
            admin.email,
            admin.phone || 'Not provided'
        ].forEach(value => {

            const cell = document.createElement('td');

            cell.textContent = value;

            row.appendChild(cell);

        });

        adminTable.appendChild(row);

    });

}


// ==========================================
// LOAD INTERNET PACKAGES
// ==========================================

async function loadPackages() {

    const table = $('packageTable');

    try {

        const response = await fetch('/api/packages', {
            credentials: 'same-origin'
        });

        if (!response.ok) {
            throw new Error('Unable to load packages.');
        }

        const packages = await response.json();

        table.innerHTML = '';

        packages.forEach(pkg => {

            const row = document.createElement('tr');

            const values = [
                pkg.label,
                `${pkg.hours} hours`,
                `${pkg.devices} device(s)`,
                `KES ${Number(pkg.price).toLocaleString()}`
            ];

            values.forEach(value => {

                const cell = document.createElement('td');

                cell.textContent = value;

                row.appendChild(cell);

            });

            table.appendChild(row);

        });

    } catch (error) {

        table.innerHTML = `
            <tr>
                <td colspan="4">
                    ${error.message}
                </td>
            </tr>
        `;

    }

}


// ==========================================
// NAVIGATION
// ==========================================

const navigationButtons =
    document.querySelectorAll('.nav-link');

const sections =
    document.querySelectorAll('.page-section');

navigationButtons.forEach(button => {

    button.addEventListener('click', () => {

        const sectionId = button.dataset.section;

        sections.forEach(section => {
            section.classList.remove('active');
        });

        navigationButtons.forEach(nav => {
            nav.classList.remove('active');
        });

        $(sectionId).classList.add('active');

        button.classList.add('active');

        $('pageTitle').textContent =
            button.textContent.trim();

        $('sidebar').classList.remove('open');

    });

});


// ==========================================
// MOBILE SIDEBAR
// ==========================================

$('menuButton').addEventListener('click', () => {

    $('sidebar').classList.toggle('open');

});


// ==========================================
// UPDATE PROFILE
// ==========================================

$('profileForm').addEventListener(
    'submit',
    async (event) => {

        event.preventDefault();

        const message = $('profileMessage');

        message.textContent = 'Saving profile...';

        message.style.color = '#087cf0';

        try {

            const data = await apiRequest(
                `${API}/profile`,
                {
                    method: 'PUT',

                    headers: {
                        'Content-Type': 'application/json'
                    },

                    body: JSON.stringify({

                        full_name: $('fullName').value.trim(),

                        email: $('profileEmail').value.trim(),

                        phone: $('profilePhone').value.trim()

                    })

                }
            );

            message.textContent =
                'Profile updated successfully.';

            message.style.color = '#12a76b';

            $('profileDisplayName').textContent =
                data.admin.full_name;

            $('sidebarName').textContent =
                data.admin.full_name;

            const initial =
                data.admin.full_name.charAt(0).toUpperCase();

            $('sidebarAvatar').textContent = initial;

            $('topAvatar').textContent = initial;

        } catch (error) {

            message.textContent = error.message;

            message.style.color = '#d93025';

        }

    }
);


// ==========================================
// PROFILE PICTURE UPLOAD
// ==========================================

$('uploadPictureButton').addEventListener(
    'click',
    () => {

        $('pictureInput').click();

    }
);


$('pictureInput').addEventListener(
    'change',
    async () => {

        const file = $('pictureInput').files[0];

        if (!file) return;

        const message = $('profileMessage');

        if (![
            'image/jpeg',
            'image/png',
            'image/webp'
        ].includes(file.type)) {

            message.textContent =
                'Choose a JPG, PNG or WEBP image.';

            message.style.color = '#d93025';

            return;

        }

        if (file.size > 2 * 1024 * 1024) {

            message.textContent =
                'Image must not exceed 2 MB.';

            message.style.color = '#d93025';

            return;

        }

        message.textContent = 'Uploading picture...';

        message.style.color = '#087cf0';

        const formData = new FormData();

        formData.append('picture', file);

        try {

            await apiRequest(
                `${API}/profile-picture`,
                {
                    method: 'POST',
                    body: formData
                }
            );

            const image =
                `${API}/profile-picture?t=${Date.now()}`;

            $('profileImage').src = image;

            $('sidebarAvatar').style.backgroundImage =
                `url("${image}")`;

            $('sidebarAvatar').style.backgroundSize =
                'cover';

            $('sidebarAvatar').textContent = '';

            $('topAvatar').style.backgroundImage =
                `url("${image}")`;

            $('topAvatar').style.backgroundSize =
                'cover';

            $('topAvatar').textContent = '';

            message.textContent =
                'Profile picture updated successfully.';

            message.style.color = '#12a76b';

        } catch (error) {

            message.textContent = error.message;

            message.style.color = '#d93025';

        }

        $('pictureInput').value = '';

    }
);


// ==========================================
// CHANGE ADMIN PASSWORD
// ==========================================

$('passwordForm').addEventListener(
    'submit',
    async (event) => {

        event.preventDefault();

        const message = $('passwordMessage');

        const currentPassword =
            $('currentPassword').value;

        const newPassword =
            $('newPassword').value;

        const confirmPassword =
            $('confirmPassword').value;

        if (newPassword.length < 12) {

            message.textContent =
                'New password must contain at least 12 characters.';

            message.style.color = '#d93025';

            return;

        }

        if (newPassword !== confirmPassword) {

            message.textContent =
                'New passwords do not match.';

            message.style.color = '#d93025';

            return;

        }

        message.textContent = 'Updating password...';

        try {

            const data = await apiRequest(
                `${API}/change-password`,
                {
                    method: 'POST',

                    headers: {
                        'Content-Type': 'application/json'
                    },

                    body: JSON.stringify({

                        currentPassword,

                        newPassword

                    })

                }
            );

            message.textContent =
                data.message;

            message.style.color = '#12a76b';

            $('passwordForm').reset();

            setTimeout(() => {

                window.location.href =
                    '/admin/login.html';

            }, 2000);

        } catch (error) {

            message.textContent = error.message;

            message.style.color = '#d93025';

        }

    }
);


// ==========================================
// ADMIN LOGOUT
// ==========================================

$('logoutButton').addEventListener(
    'click',
    async () => {

        if (!confirm('Are you sure you want to log out?')) {
            return;
        }

        try {

            await apiRequest(
                `${API}/logout`,
                {
                    method: 'POST'
                }
            );

        } catch (error) {

            console.error('Logout error:', error);

        }

        window.location.href =
            '/admin/login.html';

    }
);


// ==========================================
// INITIALIZE DASHBOARD
// ==========================================

async function initializeDashboard() {

    try {

        await loadAdminProfile();

        await loadOverview();

        await loadPackages();

        console.log(
            'WIFE CONNECT KENYA dashboard initialized.'
        );

    } catch (error) {

        console.error(
            'Dashboard initialization failed:',
            error
        );

        if (error.message) {
            alert(error.message);
        }

    }

}

initializeDashboard();
