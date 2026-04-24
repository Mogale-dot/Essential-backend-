const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

exports.sendInviteEmail = async ({ email, password }) => {
  await resend.emails.send({
    from: process.env.FROM_EMAIL,
    to: email,
    subject: 'You have been added to a salon',
    html: `
      <h2>Welcome 👋</h2>
      <p>You’ve been added to a salon team.</p>

      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Password:</strong> ${password}</p>

      <p>Please log in and change your password.</p>
    `,
  });
};
