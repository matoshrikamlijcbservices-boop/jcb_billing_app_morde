module {
  /// A payment reminder for a bill
  public type PaymentReminder = {
    id : Text;
    billId : Text;
    billNumber : Text;
    customerName : Text;
    amountDue : Float;
    dueDate : Int;      // nanoseconds since epoch
    notes : Text;
    createdAt : Int;    // nanoseconds since epoch
  };
};
