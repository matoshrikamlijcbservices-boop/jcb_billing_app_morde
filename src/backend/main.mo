import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Types "types/bills";
import BillsLib "lib/bills";
import BillsApi "mixins/bills-api";
import RemindersLib "lib/reminders";
import RemindersApi "mixins/reminders-api";

actor {
  // Per-user bill stores: Principal → (billId → Bill)
  let bills = Map.empty<Principal, BillsLib.UserBills>();
  // Per-user customer stores: Principal → (nameContact → Customer)
  let customers = Map.empty<Principal, BillsLib.UserCustomers>();
  // Per-user rates: Principal → Rates
  let rates = Map.empty<Principal, Types.Rates>();
  // Per-user reminder stores: Principal → (reminderId → PaymentReminder)
  let reminders = Map.empty<Principal, RemindersLib.UserReminders>();

  include BillsApi(bills, customers, rates);
  include RemindersApi(reminders);
};
