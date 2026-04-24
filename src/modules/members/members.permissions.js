module.exports = {
  Admin: ["*"],
  Manager: ["manage_staff", "manage_bookings"],
  Stylist: ["view_appointments", "update_services"],
  Receptionist: ["book_appointments", "take_payments"],
};
 
