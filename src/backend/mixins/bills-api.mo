import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "../types/bills";
import BillsLib "../lib/bills";

/// Per-user state containers injected by main.mo.
mixin (
  bills : Map.Map<Principal, BillsLib.UserBills>,
  customers : Map.Map<Principal, BillsLib.UserCustomers>,
  rates : Map.Map<Principal, Types.Rates>,
) {

  // -- Internal helpers

  func requireAuth(caller : Principal) {
    if (caller.isAnonymous()) {
      Runtime.trap("Anonymous caller not allowed");
    };
  };

  /// Returns the user's bill map, lazily initialising it on first write.
  /// MUST only be called from update (non-query) functions.
  func getOrInitUserBills(caller : Principal) : BillsLib.UserBills {
    switch (bills.get(caller)) {
      case (?m) m;
      case null {
        let m = Map.empty<Text, Types.Bill>();
        bills.add(caller, m);
        m;
      };
    };
  };

  /// Returns the user's customer map, lazily initialising it on first write.
  /// MUST only be called from update (non-query) functions.
  func getOrInitUserCustomers(caller : Principal) : BillsLib.UserCustomers {
    switch (customers.get(caller)) {
      case (?m) m;
      case null {
        let m = Map.empty<Text, Types.Customer>();
        customers.add(caller, m);
        m;
      };
    };
  };

  // -- Bills

  public shared ({ caller }) func createBill(bill : Types.Bill) : async () {
    requireAuth(caller);
    BillsLib.createBill(getOrInitUserBills(caller), bill);
  };

  public shared ({ caller }) func updateBill(bill : Types.Bill) : async () {
    requireAuth(caller);
    BillsLib.updateBill(getOrInitUserBills(caller), bill);
  };

  public shared ({ caller }) func deleteBill(id : Text) : async () {
    requireAuth(caller);
    switch (bills.get(caller)) {
      case (?m) BillsLib.deleteBill(m, id);
      case null ();
    };
  };

  public shared query ({ caller }) func getBills() : async [Types.Bill] {
    requireAuth(caller);
    switch (bills.get(caller)) {
      case (?m) BillsLib.getBills(m);
      case null [];
    };
  };

  // -- Customers

  public shared ({ caller }) func upsertCustomer(customer : Types.Customer) : async () {
    requireAuth(caller);
    BillsLib.upsertCustomer(getOrInitUserCustomers(caller), customer);
  };

  public shared query ({ caller }) func getCustomers() : async [Types.Customer] {
    requireAuth(caller);
    switch (customers.get(caller)) {
      case (?m) BillsLib.getCustomers(m);
      case null [];
    };
  };

  public shared ({ caller }) func deleteCustomer(nameContact : Text) : async () {
    requireAuth(caller);
    switch (customers.get(caller)) {
      case (?m) BillsLib.deleteCustomer(m, nameContact);
      case null ();
    };
  };

  // -- Rates

  public shared ({ caller }) func setRates(r : Types.Rates) : async () {
    requireAuth(caller);
    BillsLib.setRates(rates, caller, r);
  };

  public shared query ({ caller }) func getRates() : async ?Types.Rates {
    requireAuth(caller);
    BillsLib.getRates(rates, caller);
  };

  // -- Utility

  public shared query func getServerTime() : async Int {
    Time.now();
  };
};
