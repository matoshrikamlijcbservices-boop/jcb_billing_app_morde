import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "../types/reminders";
import RemindersLib "../lib/reminders";

/// Per-user reminders state injected by main.mo.
mixin (
  reminders : Map.Map<Principal, RemindersLib.UserReminders>,
) {

  // -- Internal helpers

  func requireAuthReminders(caller : Principal) {
    if (caller.isAnonymous()) {
      Runtime.trap("Anonymous caller not allowed");
    };
  };

  /// Returns the user's reminder map, lazily initialising it on first write.
  /// MUST only be called from update (non-query) functions.
  func getOrInitUserReminders(caller : Principal) : RemindersLib.UserReminders {
    switch (reminders.get(caller)) {
      case (?m) m;
      case null {
        let m = Map.empty<Text, Types.PaymentReminder>();
        reminders.add(caller, m);
        m;
      };
    };
  };

  // -- Reminders

  public shared ({ caller }) func createReminder(reminder : Types.PaymentReminder) : async Bool {
    requireAuthReminders(caller);
    RemindersLib.createReminder(getOrInitUserReminders(caller), reminder);
    true;
  };

  public shared query ({ caller }) func getReminders() : async [Types.PaymentReminder] {
    requireAuthReminders(caller);
    switch (reminders.get(caller)) {
      case (?m) RemindersLib.getReminders(m);
      case null [];
    };
  };

  public shared ({ caller }) func deleteReminder(id : Text) : async Bool {
    requireAuthReminders(caller);
    switch (reminders.get(caller)) {
      case (?m) RemindersLib.deleteReminder(m, id);
      case null false;
    };
  };
};
