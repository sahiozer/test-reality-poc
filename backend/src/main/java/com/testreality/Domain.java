package com.testreality;
import java.util.List;
import java.util.Map;
public enum Domain {
    CUSTOMER_LENDING("Customer & Lending",List.of("prod_snapshot","test_env"),"customers",6,
        List.of(Map.of("label","0 active accounts","key","customers_0_active_accounts"),Map.of("label","1 active account","key","customers_1_active_account"),Map.of("label","2+ active accounts","key","customers_2plus_active_accounts"))),
    CARDS("Cards",List.of("prod_cards","test_cards"),"cards",8,
        List.of(Map.of("label","0 active cards","key","entities_0_active_cards"),Map.of("label","1 active card","key","entities_1_active_card"),Map.of("label","2+ active cards","key","entities_2plus_active_cards")));
    public final String displayName,entityLabel;
    public final List<String> environments;
    public final int stateFeatureCount;
    public final List<Map<String,String>> distribution;
    Domain(String displayName,List<String> environments,String entityLabel,int stateFeatureCount,List<Map<String,String>> distribution) {this.displayName=displayName;this.environments=environments;this.entityLabel=entityLabel;this.stateFeatureCount=stateFeatureCount;this.distribution=distribution;}
}
