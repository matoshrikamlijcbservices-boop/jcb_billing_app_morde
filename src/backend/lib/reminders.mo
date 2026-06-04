import Map "mo:core/Map";
import Types "../types/reminders";

module {
  public type UserReminders = Map.Map<Text, Types.PaymentReminder>;

  /// Create or replace a reminder by id (safe upsert — idempotent).
  public func createReminder(
    userReminders : UserReminders,
    reminder : Types.PaymentReminder,
  ) {
    userReminders.remove(reminder.id);
    userReminders.add(reminder.id, reminder);
  };

  /// Return all reminders for a user as an array.
  public func getReminders(userReminders : UserReminders) : [Types.PaymentReminder] {
    userReminders.values().toArray();
  };

  /// Remove a reminder by id.
  public func deleteReminder(
    userReminders : UserReminders,
    id : Text,
  ) : Bool {
    switch (userReminders.get(id)) {
      case (?_) {
        userReminders.remove(id);
        true;
      };
      case null false;
    };
  };
};
