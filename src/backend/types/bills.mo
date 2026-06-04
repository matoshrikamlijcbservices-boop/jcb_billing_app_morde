module {
  /// A single work entry (bucket or breaker)
  public type Entry = {
    id : Text;
    entryType : Text;  // "bucket" or "breaker"
    startTime : Text;
    endTime : Text;
  };

  /// A JCB machine with a list of work entries
  public type Machine = {
    id : Text;
    number : Text;
    entries : [Entry];
  };

  /// Rates per hour for bucket and breaker
  public type Rates = {
    bucket : Float;
    breaker : Float;
  };

  /// A complete bill record
  public type Bill = {
    id : Text;
    customerName : Text;
    customerContact : Text;
    dateOfWork : Text;
    paymentDate : ?Text;
    rates : Rates;
    machines : [Machine];
    amountPaid : Float;
    grandTotal : Float;
    bucketTotalHours : Float;
    bucketTotalCost : Float;
    breakerTotalHours : Float;
    breakerTotalCost : Float;
    paymentStatus : Text;
    savedAt : Int;  // nanoseconds since epoch
  };

  /// A saved customer record
  public type Customer = {
    name : Text;
    contact : Text;
    updatedAt : Int;  // nanoseconds since epoch
  };
};
