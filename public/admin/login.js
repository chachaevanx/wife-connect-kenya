const loginForm = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginButton = document.getElementById('loginButton');
const message = document.getElementById('message');
const togglePassword = document.getElementById('togglePassword');

// Show or hide password
togglePassword.addEventListener('click', () => {

    const isPassword =
        passwordInput.type === 'password';

    passwordInput.type =
        isPassword ? 'text' : 'password';

    togglePassword.textContent =
        isPassword ? 'Hide' : 'Show';

});

// Check whether administrator is already logged in
async function checkSession() {

    try {

        const response = await fetch('/api/admin/me', {
            credentials: 'same-origin'
        });

        if (response.ok) {
            window.location.href = '/admin/dashboard.html';
        }

    } catch (error) {

        console.error('Session check failed:', error);

    }

}

checkSession();

// Handle login
loginForm.addEventListener('submit', async (event) => {

    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    message.textContent = 'Authenticating...';

    loginButton.disabled = true;
    loginButton.textContent = 'Please wait...';

    try {

        const response = await fetch('/api/admin/login', {

            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            credentials: 'same-origin',

            body: JSON.stringify({
                email,
                password
            })

        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || 'Login failed.'
            );
        }

        message.style.color = '#63f5a2';
        message.textContent = 'Login successful! Redirecting...';

        window.location.href = '/admin/dashboard.html';

    } catch (error) {

        message.style.color = '#ff8585';
        message.textContent = error.message;

        loginButton.disabled = false;
        loginButton.textContent = 'Sign In →';

    }

});
